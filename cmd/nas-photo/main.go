package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

//go:embed web/*
var assets embed.FS

type Root struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Name string `json:"name"`
}
type Item struct {
	ID       string    `json:"id"`
	RootID   string    `json:"rootId"`
	Path     string    `json:"-"`
	Name     string    `json:"name"`
	Kind     string    `json:"kind"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
	Width    int       `json:"width,omitempty"`
	Height   int       `json:"height,omitempty"`
}
type Settings struct {
	Password  string            `json:"password,omitempty"`
	Roots     []Root            `json:"roots"`
	Shortcuts map[string]string `json:"shortcuts"`
}
type store struct {
	mu   sync.RWMutex
	file string
	Settings
}
type app struct {
	st                  *store
	allowed             []string
	log                 *slog.Logger
	scanMu              sync.Mutex
	items               []Item
	scanning            bool
	scanDone, scanTotal int
	sessions            map[string]time.Time
	sessionMu           sync.Mutex
	cacheDir            string
	catalogFile         string
	thumbMu             sync.Mutex
}

func main() {
	data := flag.String("data-dir", "nas-photo-data", "state directory")
	cache := flag.String("cache-dir", "nas-photo-cache", "thumbnail cache directory")
	addr := flag.String("addr", ":9070", "listen address")
	allowed := flag.String("allowed-root", "", "comma-separated folders allowed for selection")
	flag.Parse()
	if err := os.MkdirAll(*data, 0700); err != nil {
		panic(err)
	}
	if err := os.MkdirAll(*cache, 0700); err != nil {
		panic(err)
	}
	s := &store{file: filepath.Join(*data, "settings.json"), Settings: Settings{Shortcuts: defaults()}}
	_ = s.load()
	a := &app{
		st: s, log: slog.Default(), sessions: map[string]time.Time{},
		cacheDir: *cache, catalogFile: filepath.Join(*data, "catalog.json"),
	}
	for _, p := range strings.Split(*allowed, ",") {
		if p = strings.TrimSpace(p); p != "" {
			if q, e := filepath.Abs(p); e == nil {
				a.allowed = append(a.allowed, filepath.Clean(q))
			}
		}
	}
	if len(a.allowed) == 0 {
		a.allowed = defaultAllowedRoots()
	}
	a.loadCatalog()
	go a.rescan(context.Background())
	mux := http.NewServeMux()
	a.routes(mux)
	srv := &http.Server{Addr: *addr, Handler: a.security(mux), ReadHeaderTimeout: 10 * time.Second}
	for _, endpoint := range listenURLs(*addr) {
		a.log.Info("NAS-PHOTO started", "url", endpoint, "data_dir", *data)
	}
	if !a.st.ready() {
		a.log.Warn("first setup required; open the browser on a trusted LAN/VPN")
	}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

// listenURLs produces copyable browser URLs for both the local machine and
// other devices on the LAN. It deliberately excludes loopback adapters from
// the LAN list.
func listenURLs(addr string) []string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return []string{"http://" + addr}
	}
	urls := []string{"http://localhost:" + port}
	if host != "" && host != "0.0.0.0" && host != "::" {
		return append(urls, "http://"+net.JoinHostPort(host, port))
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		return urls
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			ip, _, err := net.ParseCIDR(addr.String())
			if err == nil && ip.To4() != nil && !ip.IsLoopback() {
				urls = append(urls, "http://"+net.JoinHostPort(ip.String(), port))
			}
		}
	}
	return urls
}

func defaultAllowedRoots() []string {
	if runtime.GOOS == "windows" {
		roots := []string{}
		for c := 'A'; c <= 'Z'; c++ {
			p := string(c) + `:\`
			if info, err := os.Stat(p); err == nil && info.IsDir() {
				roots = append(roots, p)
			}
		}
		return roots
	}
	roots := []string{}
	for _, p := range []string{"/mnt", "/media", "/srv"} {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			roots = append(roots, p)
		}
	}
	if len(roots) == 0 {
		return []string{"/"}
	}
	return roots
}
func defaults() map[string]string {
	return map[string]string{
		"prev1": "KeyQ", "next1": "KeyW",
		"prev2": "KeyA", "next2": "KeyS",
		"loop": "KeyL", "mute": "KeyM", "splitToggle": "KeyE",
	}
}
func (s *store) load() error {
	b, e := os.ReadFile(s.file)
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, &s.Settings); e != nil {
		return e
	}
	merged := defaults()
	for name, code := range s.Shortcuts {
		merged[name] = code
	}
	s.Shortcuts = merged
	return nil
}
func (s *store) save() error {
	b, e := json.MarshalIndent(s.Settings, "", "  ")
	if e != nil {
		return e
	}
	tmp := s.file + ".tmp"
	if e = os.WriteFile(tmp, b, 0600); e != nil {
		return e
	}
	return os.Rename(tmp, s.file)
}
func (s *store) ready() bool { s.mu.RLock(); defer s.mu.RUnlock(); return s.Password != "" }
func (a *app) routes(m *http.ServeMux) {
	m.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	m.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if a.st.ready() {
			w.WriteHeader(204)
		} else {
			http.Error(w, "setup required", 503)
		}
	})
	m.HandleFunc("/api/bootstrap/status", a.status)
	m.HandleFunc("/api/bootstrap/complete", a.setup)
	m.HandleFunc("/api/auth/login", a.login)
	m.HandleFunc("/api/auth/logout", a.logout)
	m.HandleFunc("/api/auth/me", a.me)
	m.HandleFunc("/api/folders/browse", a.browse)
	m.HandleFunc("/api/folders/roots", a.roots)
	m.HandleFunc("/api/roots", a.addRoot)
	m.HandleFunc("/api/roots/", a.deleteRoot)
	m.HandleFunc("/api/media", a.media)
	m.HandleFunc("/api/media/", a.mediaByID)
	m.HandleFunc("/api/index/current", a.index)
	m.HandleFunc("/api/index/rescan", a.rescanAPI)
	m.HandleFunc("/api/settings", a.settings)
	m.HandleFunc("/api/settings/shortcuts", a.shortcuts)
	m.HandleFunc("/api/settings/reset", a.reset)
	sub, _ := fs.Sub(assets, "web")
	m.Handle("/", http.FileServer(http.FS(sub)))
}
func (a *app) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}
func body(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}
func (a *app) status(w http.ResponseWriter, r *http.Request) {
	a.st.mu.RLock()
	foldersRequired := a.st.Password != "" && len(a.st.Roots) == 0
	a.st.mu.RUnlock()
	jsonOut(w, map[string]any{"setupRequired": !a.st.ready(), "foldersRequired": foldersRequired, "allowedRoots": a.allowed})
}
func hash(p string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	h := argon2.IDKey([]byte(p), salt, 3, 64*1024, 4, 32)
	return base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(h)
}
func verify(encoded, p string) bool {
	z := strings.Split(encoded, "$")
	if len(z) != 2 {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(z[0])
	if e != nil {
		return false
	}
	want, e := base64.RawStdEncoding.DecodeString(z[1])
	if e != nil {
		return false
	}
	got := argon2.IDKey([]byte(p), salt, 3, 64*1024, 4, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}
func (a *app) setup(w http.ResponseWriter, r *http.Request) {
	if a.st.ready() {
		http.Error(w, "already configured", 409)
		return
	}
	var x struct {
		Password, Confirm string
		Roots             []string
	}
	if body(r, &x) != nil {
		http.Error(w, "入力を読み取れませんでした。もう一度入力してください。", 400)
		return
	}
	length := len([]rune(x.Password))
	if length < 8 {
		http.Error(w, "パスワードは8文字以上にしてください。", 400)
		return
	}
	if length > 1024 {
		http.Error(w, "パスワードは1024文字以内にしてください。", 400)
		return
	}
	if x.Password != x.Confirm {
		http.Error(w, "パスワードと確認用パスワードを同じ内容にしてください。", 400)
		return
	}
	a.st.mu.Lock()
	a.st.Password = hash(x.Password)
	e := a.st.save()
	a.st.mu.Unlock()
	if e != nil {
		http.Error(w, "could not save settings", 500)
		return
	}
	a.newSession(w)
	jsonOut(w, map[string]bool{"ok": true})
}
func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var x struct{ Password string }
	if body(r, &x) != nil || !a.st.ready() {
		http.Error(w, "invalid credentials", 401)
		return
	}
	a.st.mu.RLock()
	ok := verify(a.st.Password, x.Password)
	a.st.mu.RUnlock()
	if !ok {
		time.Sleep(300 * time.Millisecond)
		http.Error(w, "invalid credentials", 401)
		return
	}
	a.newSession(w)
	jsonOut(w, map[string]bool{"ok": true})
}
func (a *app) newSession(w http.ResponseWriter) {
	b := make([]byte, 32)
	rand.Read(b)
	t := base64.RawURLEncoding.EncodeToString(b)
	a.sessionMu.Lock()
	a.sessions[t] = time.Now().Add(24 * time.Hour)
	a.sessionMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "nas_photo_session", Value: t, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 86400})
}
func (a *app) authed(w http.ResponseWriter, r *http.Request) bool {
	c, e := r.Cookie("nas_photo_session")
	if e != nil {
		return false
	}
	a.sessionMu.Lock()
	exp, ok := a.sessions[c.Value]
	if ok && time.Now().After(exp) {
		delete(a.sessions, c.Value)
		ok = false
	}
	a.sessionMu.Unlock()
	if !ok {
		http.Error(w, "login required", 401)
	}
	return ok
}
func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie("nas_photo_session"); e == nil {
		a.sessionMu.Lock()
		delete(a.sessions, c.Value)
		a.sessionMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "nas_photo_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	jsonOut(w, map[string]bool{"ok": true})
}
func (a *app) me(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	jsonOut(w, map[string]bool{"authenticated": true})
}
func (a *app) validRoots(paths []string) ([]Root, error) {
	if len(paths) == 0 {
		return nil, errors.New("at least one folder is required")
	}
	out := []Root{}
	for _, p := range paths {
		q, e := filepath.Abs(p)
		if e != nil {
			return nil, e
		}
		q = filepath.Clean(q)
		good := false
		for _, base := range a.allowed {
			rel, e := filepath.Rel(base, q)
			if e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
				good = true
			}
		}
		if !good {
			return nil, fmt.Errorf("folder is outside allowed roots")
		}
		info, e := os.Stat(q)
		if e != nil || !info.IsDir() {
			return nil, fmt.Errorf("folder is not readable")
		}
		for _, r := range out {
			rel, _ := filepath.Rel(r.Path, q)
			back, _ := filepath.Rel(q, r.Path)
			if rel == "." || (!strings.HasPrefix(rel, "..") && !strings.HasPrefix(back, "..")) {
				return nil, errors.New("duplicate or nested folders are not allowed")
			}
		}
		out = append(out, Root{ID: id(), Path: q, Name: filepath.Base(q)})
	}
	return out, nil
}
func id() string { b := make([]byte, 12); rand.Read(b); return base64.RawURLEncoding.EncodeToString(b) }
func (a *app) browse(w http.ResponseWriter, r *http.Request) {
	// The first-run screen needs this endpoint before a session exists. Once a
	// password is configured, folder names are never exposed without login.
	if a.st.ready() && !a.authed(w, r) {
		return
	}
	p := r.URL.Query().Get("path")
	if p == "" {
		jsonOut(w, map[string]any{"path": "", "parent": "", "folders": a.allowed})
		return
	}
	q, e := filepath.Abs(p)
	if e != nil {
		http.Error(w, "bad path", 400)
		return
	}
	entries, e := os.ReadDir(q)
	if e != nil {
		http.Error(w, "cannot read folder", 400)
		return
	}
	dirs := []string{}
	for _, x := range entries {
		if x.IsDir() {
			dirs = append(dirs, filepath.Join(q, x.Name()))
		}
	}
	sort.Strings(dirs)
	parent := filepath.Dir(q)
	if parent == q {
		parent = ""
	}
	jsonOut(w, map[string]any{"path": q, "parent": parent, "folders": dirs})
}
func (a *app) roots(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	// A JSON empty array is part of the UI contract. Encoding a nil slice as
	// null made the first-run folder screen fail before any folder was added.
	roots := append([]Root{}, a.st.Roots...)
	jsonOut(w, roots)
}
func (a *app) addRoot(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	var x struct{ Path string }
	if body(r, &x) != nil {
		http.Error(w, "bad request", 400)
		return
	}
	a.st.mu.RLock()
	old := append([]Root(nil), a.st.Roots...)
	a.st.mu.RUnlock()
	paths := []string{}
	for _, r := range old {
		paths = append(paths, r.Path)
	}
	paths = append(paths, x.Path)
	roots, e := a.validRoots(paths)
	if e != nil {
		http.Error(w, e.Error(), 400)
		return
	}
	a.st.mu.Lock()
	a.st.Roots = roots
	e = a.st.save()
	a.st.mu.Unlock()
	if e != nil {
		http.Error(w, "save failed", 500)
		return
	}
	go a.rescan(context.Background())
	jsonOut(w, roots)
}
func (a *app) deleteRoot(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/api/roots/")
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	out := []Root{}
	for _, x := range a.st.Roots {
		if x.ID != key {
			out = append(out, x)
		}
	}
	a.st.Roots = out
	_ = a.st.save()
	go a.rescan(context.Background())
	jsonOut(w, out)
}
func kind(n string) string {
	switch strings.ToLower(filepath.Ext(n)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".bmp":
		return "image"
	case ".gif":
		return "gif"
	case ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi":
		return "video"
	}
	return ""
}

type catalogItem struct {
	ID       string    `json:"id"`
	RootID   string    `json:"rootId"`
	Path     string    `json:"path"`
	Name     string    `json:"name"`
	Kind     string    `json:"kind"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
	Width    int       `json:"width,omitempty"`
	Height   int       `json:"height,omitempty"`
}

func (a *app) loadCatalog() {
	data, err := os.ReadFile(a.catalogFile)
	if err != nil {
		return
	}
	var stored []catalogItem
	if json.Unmarshal(data, &stored) != nil {
		return
	}
	items := make([]Item, 0, len(stored))
	for _, item := range stored {
		items = append(items, Item{
			ID: item.ID, RootID: item.RootID, Path: item.Path, Name: item.Name,
			Kind: item.Kind, Size: item.Size, Modified: item.Modified,
			Width: item.Width, Height: item.Height,
		})
	}
	a.items = items
}

func (a *app) saveCatalog(items []Item) {
	stored := make([]catalogItem, 0, len(items))
	for _, item := range items {
		stored = append(stored, catalogItem{
			ID: item.ID, RootID: item.RootID, Path: item.Path, Name: item.Name,
			Kind: item.Kind, Size: item.Size, Modified: item.Modified,
			Width: item.Width, Height: item.Height,
		})
	}
	data, err := json.Marshal(stored)
	if err != nil {
		return
	}
	tmp := a.catalogFile + ".tmp"
	if os.WriteFile(tmp, data, 0600) == nil {
		_ = os.Rename(tmp, a.catalogFile)
	}
}

func (a *app) rescan(ctx context.Context) {
	a.scanMu.Lock()
	if a.scanning {
		a.scanMu.Unlock()
		return
	}
	a.scanning = true
	a.scanDone = 0
	a.scanTotal = 0
	a.scanMu.Unlock()
	defer func() { a.scanMu.Lock(); a.scanning = false; a.scanMu.Unlock() }()
	a.st.mu.RLock()
	roots := append([]Root(nil), a.st.Roots...)
	a.st.mu.RUnlock()
	var found []Item
	for _, root := range roots {
		_ = filepath.WalkDir(root.Path, func(path string, d fs.DirEntry, e error) error {
			if e != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			k := kind(d.Name())
			if k == "" {
				return nil
			}
			info, e := d.Info()
			if e != nil {
				return nil
			}
			rel, e := filepath.Rel(root.Path, path)
			if e != nil {
				return nil
			}
			a.scanMu.Lock()
			a.scanTotal++
			a.scanDone++
			a.scanMu.Unlock()
			width, height := mediaDimensions(path, k)
			found = append(found, Item{
				ID: stableID(root.ID, rel), RootID: root.ID, Path: path, Name: d.Name(),
				Kind: k, Size: info.Size(), Modified: info.ModTime(), Width: width, Height: height,
			})
			return nil
		})
	}
	a.scanMu.Lock()
	a.items = found
	a.scanDone = len(found)
	a.scanTotal = len(found)
	a.scanMu.Unlock()
	a.saveCatalog(found)
}

func mediaDimensions(path, mediaKind string) (int, int) {
	if mediaKind == "video" {
		return 0, 0
	}
	file, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer file.Close()
	config, _, err := image.DecodeConfig(file)
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return 0, 0
	}
	return config.Width, config.Height
}

func stableID(root, rel string) string {
	h := sha256.Sum256([]byte(root + "\x00" + rel))
	return base64.RawURLEncoding.EncodeToString(h[:12])
}
func (a *app) index(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	a.scanMu.Lock()
	defer a.scanMu.Unlock()
	jsonOut(w, map[string]any{"scanning": a.scanning, "done": a.scanDone, "total": a.scanTotal, "percent": func() int {
		if a.scanTotal == 0 {
			return 100
		}
		return a.scanDone * 100 / a.scanTotal
	}()})
}
func (a *app) rescanAPI(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	go a.rescan(r.Context())
	jsonOut(w, map[string]bool{"ok": true})
}
func (a *app) media(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	filter := r.URL.Query().Get("filter")
	sortBy := r.URL.Query().Get("sort")
	order := r.URL.Query().Get("order")
	a.scanMu.Lock()
	items := append([]Item(nil), a.items...)
	a.scanMu.Unlock()
	out := items[:0]
	for _, x := range items {
		if filter == "video" && x.Kind != "video" {
			continue
		}
		if filter == "image" && x.Kind == "video" {
			continue
		}
		out = append(out, x)
	}
	sortItems(out, sortBy, order)
	total := len(out)
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	next := -1
	if end < total {
		next = end
	}
	jsonOut(w, map[string]any{"items": out[offset:end], "total": total, "nextOffset": next})
}

func sortItems(items []Item, sortBy, order string) {
	ascending := order == "asc"
	sort.SliceStable(items, func(i, j int) bool {
		var cmp int
		if sortBy == "name" {
			cmp = strings.Compare(strings.ToLower(items[i].Name), strings.ToLower(items[j].Name))
		} else if items[i].Modified.Before(items[j].Modified) {
			cmp = -1
		} else if items[i].Modified.After(items[j].Modified) {
			cmp = 1
		} else {
			cmp = strings.Compare(items[i].ID, items[j].ID)
		}
		if ascending {
			return cmp < 0
		}
		return cmp > 0
	})
}
func (a *app) mediaByID(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/media/"), "/")
	if len(parts) == 0 {
		return
	}
	var it *Item
	a.scanMu.Lock()
	for i := range a.items {
		if a.items[i].ID == parts[0] {
			x := a.items[i]
			it = &x
			break
		}
	}
	a.scanMu.Unlock()
	if it == nil {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 1 {
		jsonOut(w, it)
		return
	}
	if parts[1] == "content" {
		f, e := os.Open(it.Path)
		if e != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		info, _ := f.Stat()
		typ := mime.TypeByExtension(filepath.Ext(it.Path))
		if typ == "" {
			typ = "application/octet-stream"
		}
		w.Header().Set("Content-Type", typ)
		w.Header().Set("Cache-Control", "private, no-cache")
		http.ServeContent(w, r, it.Name, info.ModTime(), f)
		return
	}
	if parts[1] == "thumbnail" {
		a.thumbnail(w, r, *it)
		return
	}
	if parts[1] == "neighbors" {
		a.neighbors(w, r, it.ID)
		return
	}
	http.NotFound(w, r)
}

func (a *app) thumbnail(w http.ResponseWriter, r *http.Request, it Item) {
	key := fmt.Sprintf("%s-%d-%d.jpg", it.ID, it.Size, it.Modified.UnixNano())
	path := filepath.Join(a.cacheDir, key)
	a.thumbMu.Lock()
	defer a.thumbMu.Unlock()
	if _, err := os.Stat(path); err != nil {
		if it.Kind == "video" {
			_ = makeVideoThumbnail(r.Context(), it.Path, path)
		} else {
			_ = makeImageThumbnail(it.Path, path)
		}
	}
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, key, info.ModTime(), f)
}

func makeImageThumbnail(source, target string) error {
	f, err := os.Open(source)
	if err != nil {
		return err
	}
	img, _, err := image.Decode(f)
	f.Close()
	if err != nil {
		return err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return errors.New("invalid image dimensions")
	}
	max := 480
	tw, th := w, h
	if tw > max || th > max {
		if tw >= th {
			th = th * max / tw
			tw = max
		} else {
			tw = tw * max / th
			th = max
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, tw, th))
	for y := 0; y < th; y++ {
		for x := 0; x < tw; x++ {
			dst.Set(x, y, img.At(b.Min.X+x*w/tw, b.Min.Y+y*h/th))
		}
	}
	tmp := target + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	err = jpeg.Encode(out, dst, &jpeg.Options{Quality: 82})
	closeErr := out.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp, target)
}

func makeVideoThumbnail(ctx context.Context, source, target string) error {
	tmp := target + ".tmp.jpg"
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", "1", "-i", source, "-frames:v", "1", "-vf", "scale=480:480:force_original_aspect_ratio=decrease", "-q:v", "4", "-y", tmp)
	if err := cmd.Run(); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}
func (a *app) neighbors(w http.ResponseWriter, r *http.Request, current string) {
	a.scanMu.Lock()
	items := append([]Item(nil), a.items...)
	a.scanMu.Unlock()
	sortItems(items, r.URL.Query().Get("sort"), r.URL.Query().Get("order"))
	for i, x := range items {
		if x.ID == current {
			v := map[string]any{}
			if i > 0 {
				v["previous"] = items[i-1]
			}
			if i+1 < len(items) {
				v["next"] = items[i+1]
			}
			jsonOut(w, v)
			return
		}
	}
	http.NotFound(w, r)
}
func (a *app) settings(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	a.st.mu.RLock()
	defer a.st.mu.RUnlock()
	jsonOut(w, map[string]any{"shortcuts": a.st.Shortcuts, "roots": append([]Root{}, a.st.Roots...)})
}

func (a *app) shortcuts(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	if r.Method != http.MethodPatch {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var values map[string]string
	if body(r, &values) != nil {
		http.Error(w, "入力を読み取れませんでした。", 400)
		return
	}
	required := []string{"prev1", "next1", "prev2", "next2", "loop", "mute", "splitToggle"}
	seen := map[string]bool{}
	for _, name := range required {
		code := values[name]
		if code == "" {
			http.Error(w, "すべてのショートカットを設定してください。", 400)
			return
		}
		if seen[code] {
			http.Error(w, "同じキーを複数の操作へ設定できません。", 400)
			return
		}
		seen[code] = true
	}
	a.st.mu.Lock()
	a.st.Shortcuts = values
	err := a.st.save()
	a.st.mu.Unlock()
	if err != nil {
		http.Error(w, "設定を保存できませんでした。", 500)
		return
	}
	jsonOut(w, values)
}
func (a *app) reset(w http.ResponseWriter, r *http.Request) {
	if !a.authed(w, r) {
		return
	}
	var x struct{ Password string }
	if body(r, &x) != nil {
		http.Error(w, "bad request", 400)
		return
	}
	a.st.mu.RLock()
	ok := verify(a.st.Password, x.Password)
	a.st.mu.RUnlock()
	if !ok {
		http.Error(w, "invalid password", 401)
		return
	}
	a.st.mu.Lock()
	a.st.Settings = Settings{Shortcuts: defaults()}
	_ = a.st.save()
	a.st.mu.Unlock()
	a.scanMu.Lock()
	a.items = nil
	a.scanMu.Unlock()
	_ = os.Remove(a.catalogFile)
	a.sessionMu.Lock()
	a.sessions = map[string]time.Time{}
	a.sessionMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "nas_photo_session", Value: "", Path: "/", MaxAge: -1})
	jsonOut(w, map[string]bool{"ok": true})
}

var _ = io.EOF
