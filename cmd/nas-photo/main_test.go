package main

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeTestJPEG(t *testing.T, path string, width, height int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 70, G: 120, B: 190, A: 255})
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, img, nil); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestSortItemsIsStableAndRespectsOrder(t *testing.T) {
	now := time.Now()
	items := []Item{
		{ID: "b", Name: "same.jpg", Modified: now},
		{ID: "a", Name: "same.jpg", Modified: now},
		{ID: "c", Name: "z.jpg", Modified: now.Add(time.Hour)},
	}
	sortItems(items, "modified", "asc", "", "")
	if items[0].ID != "a" || items[1].ID != "b" || items[2].ID != "c" {
		t.Fatalf("unexpected ascending order: %#v", items)
	}
	sortItems(items, "modified", "desc", "", "")
	if items[0].ID != "c" {
		t.Fatalf("unexpected descending order: %#v", items)
	}
}

func TestDateSortCanUseNameWithinSameDay(t *testing.T) {
	dayOne := time.Date(2026, 9, 3, 8, 0, 0, 0, time.Local)
	dayTwo := dayOne.AddDate(0, 0, 1)
	items := []Item{
		{ID: "z", Name: "Zeta.jpg", Modified: dayOne},
		{ID: "a", Name: "alpha.jpg", Modified: dayOne.Add(12 * time.Hour)},
		{ID: "m", Name: "Middle.jpg", Modified: dayTwo},
	}
	sortItems(items, "modified", "asc", "", "same-day-name")
	if items[0].ID != "a" || items[1].ID != "z" || items[2].ID != "m" {
		t.Fatalf("unexpected same-day ascending order: %#v", items)
	}
	sortItems(items, "modified", "desc", "", "same-day-name")
	if items[0].ID != "m" || items[1].ID != "a" || items[2].ID != "z" {
		t.Fatalf("unexpected same-day descending order: %#v", items)
	}
}

func TestRandomSortIsStableForSeedAndChangesWithNewSeed(t *testing.T) {
	items := make([]Item, 20)
	for i := range items {
		items[i] = Item{ID: fmt.Sprintf("item-%02d", i)}
	}
	first := append([]Item(nil), items...)
	second := append([]Item(nil), items...)
	third := append([]Item(nil), items...)
	sortItems(first, "random", "asc", "seed-one", "")
	sortItems(second, "random", "desc", "seed-one", "")
	sortItems(third, "random", "asc", "seed-two", "")
	for i := range first {
		if first[i].ID != second[i].ID {
			t.Fatalf("same random seed produced different order at %d: %s != %s", i, first[i].ID, second[i].ID)
		}
	}
	same := true
	for i := range first {
		if first[i].ID != third[i].ID {
			same = false
			break
		}
	}
	if same {
		t.Fatal("different random seeds produced the same order")
	}
}

func TestRandomSortMenuUsesOneSeedAcrossPageLoads(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"choice(t('random'), 'sort', 'random', draft.sort === 'random')",
		"seed: state.randomSeed",
		"if (draft.sort === 'random' && previous !== 'random') draft.randomSeed = createRandomSeed()",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("random sort UI is missing %q", feature)
		}
	}
}

func TestSortMenuSupportsSameDayNameSubSort(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"subSort: stored.subSort || ''",
		"subsort: state.subSort",
		"choice(t('sameDayName'), 'subsort', 'same-day-name'",
		"!isDateSort())",
		"draft.subSort = button.dataset.value",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("same-day name sub-sort UI is missing %q", feature)
		}
	}
}

func TestSortDialogStagesChangesUntilApply(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"function showSortDialog()",
		"sort: state.sort",
		"toggle ${selected ? 'selected' : ''}",
		"class=\"sort-choice-grid sort-basis-grid\"",
		"dialog-shell-actions",
		"if (!isDateSort()) draft.subSort = ''",
		"$('#sort-apply', overlay).onclick",
		"state.sort = draft.sort",
		"state.subSort = draft.subSort",
		"savePreferences();",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("staged sort dialog is missing %q", feature)
		}
	}
	subSortSection := strings.Index(source, `<div class="option-section"><div class="option-legend">${escapeHTML(t('subSort'))}</div>`)
	orderSection := strings.Index(source, `<div class="option-section"><div class="option-legend">${escapeHTML(t('order'))}</div>`)
	if subSortSection < 0 || orderSection < 0 || subSortSection > orderSection {
		t.Fatal("secondary sort must be directly below the primary sort and before order")
	}
	if strings.Contains(source, "<m3e-button-group") {
		t.Fatal("M3E button groups must not own NAS-PHOTO option layout")
	}
}

func TestTopOptionDialogsStageChangesUntilSave(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"function optionDialog(title, sections, initialValues, onSave)",
		"const draft = {...initialValues}",
		"draft[button.dataset.group] = button.dataset.value",
		"id=\"option-close\"",
		"id=\"option-save\"",
		"await onSave(values)",
		"[t('display'), 'layout'",
		"[t('mediaType'), 'filter'",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("staged top option dialog is missing %q", feature)
		}
	}
}

func TestScanDialogRunsActionsImmediately(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"$('#scan-menu').onclick = () => actionDialog(t('rescan')",
		"function actionDialog(title, sections, onSelect)",
		"closeMaterialDialog(overlay);",
		"await onSelect(value);",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("immediate scan dialog is missing %q", feature)
		}
	}
}

func TestMaterialExpressiveShellIsBundledLocally(t *testing.T) {
	indexBytes, err := assets.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	index := string(indexBytes)
	for _, feature := range []string{
		"m3e.bundle.js",
		"m3e-overrides.css",
		"<m3e-theme color=\"#72a7ff\" variant=\"neutral\" scheme=\"dark\" motion=\"expressive\" strong-focus>",
	} {
		if !strings.Contains(index, feature) {
			t.Fatalf("M3E shell is missing %q", feature)
		}
	}
	bundle, err := assets.ReadFile("web/m3e.bundle.js")
	if err != nil || len(bundle) < 1000 {
		t.Fatalf("local M3E bundle missing or unexpectedly small: bytes=%d err=%v", len(bundle), err)
	}
}

func TestGalleryHeaderShowsTitleIconsAndSettings(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		`<strong class="top-title">NAS-PHOTO</strong>`,
		`<div class="top top-actions" aria-label="NAS-PHOTO"`,
		`<m3e-icon slot="icon" name="sort"></m3e-icon>`,
		`<m3e-icon slot="icon" name="grid_view"></m3e-icon>`,
		`<m3e-icon slot="icon" name="filter_alt"></m3e-icon>`,
		`<m3e-icon slot="icon" name="sync"></m3e-icon>`,
		`id="settings"`,
		`<m3e-icon name="settings"></m3e-icon>`,
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("gallery header is missing %q", feature)
		}
	}
	if strings.Contains(source, `<m3e-toolbar class="top"`) {
		t.Fatal("header actions must not use m3e-toolbar because its paint layer can cover adjacent title/settings controls")
	}
}

func TestExpressiveMotionRunsDoubleSpeedWithoutOSMotionPreference(t *testing.T) {
	for _, name := range []string{"web/app.js", "web/style.css", "web/m3e-overrides.css", "web/m3e.bundle.js"} {
		content, err := assets.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(content), "prefers-reduced-motion") {
			t.Fatalf("%s still depends on the OS reduced-motion preference", name)
		}
	}
	overrides, err := assets.ReadFile("web/m3e-overrides.css")
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		"--md-sys-motion-spring-fast-spatial: 175ms cubic-bezier(0.42, 1.67, 0.21, 0.90)",
		"--md-sys-motion-spring-default-spatial: 250ms cubic-bezier(0.38, 1.21, 0.22, 1.00)",
		"--md-sys-motion-spring-slow-spatial: 325ms cubic-bezier(0.39, 1.29, 0.35, 0.98)",
		"--md-sys-motion-duration-long-2: 250ms",
	} {
		if !strings.Contains(string(overrides), token) {
			t.Fatalf("2x motion override is missing %q", token)
		}
	}
}

func TestUnavailableRootKeepsPreviousIndex(t *testing.T) {
	db, err := openIndexDB(filepath.Join(t.TempDir(), "index.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	old := Item{
		ID: "old", RootID: "root", Path: filepath.Join(t.TempDir(), "old.jpg"),
		Name: "old.jpg", Kind: "image", Size: 10, Modified: time.Now(),
	}
	if err := replaceIndexedItems(db, []Item{old}); err != nil {
		t.Fatal(err)
	}
	a := &app{
		st: &store{Settings: Settings{Roots: []Root{{
			ID: "root", Name: "offline", Path: filepath.Join(t.TempDir(), "missing"),
		}}}},
		db: db, items: []Item{old},
	}
	a.rescan(t.Context())
	items, err := loadIndexedItems(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != old.ID {
		t.Fatalf("unavailable root removed the previous index: %#v", items)
	}
	if len(a.scanErrors) == 0 {
		t.Fatal("unavailable root was not reported")
	}
}

func TestBulkThumbnailGenerationOnlyCreatesMissingFiles(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.jpg")
	writeTestJPEG(t, source, 800, 400)
	item := Item{ID: "image", Path: source, Name: "source.jpg", Kind: "image", Size: 1, Modified: time.Now()}
	a := &app{cacheDir: filepath.Join(dir, "cache"), items: []Item{item}}
	if err := os.MkdirAll(a.cacheDir, 0700); err != nil {
		t.Fatal(err)
	}
	a.generateMissingThumbnails()
	_, target := a.thumbnailPath(item)
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("bulk thumbnail was not created: %v", err)
	}
	if a.thumbnailing || a.thumbDone != 1 || a.thumbTotal != 1 || a.thumbErrors != 0 {
		t.Fatalf("unexpected thumbnail progress: running=%v done=%d total=%d errors=%d",
			a.thumbnailing, a.thumbDone, a.thumbTotal, a.thumbErrors)
	}
	a.generateMissingThumbnails()
	if a.thumbTotal != 0 || a.thumbDone != 0 {
		t.Fatalf("cached thumbnail was regenerated: done=%d total=%d", a.thumbDone, a.thumbTotal)
	}
}

func TestThumbnailRegenerationReplacesCachedFile(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.jpg")
	writeTestJPEG(t, source, 800, 400)
	item := Item{ID: "image", Path: source, Name: "source.jpg", Kind: "image", Size: 1, Modified: time.Now()}
	a := &app{cacheDir: filepath.Join(dir, "cache"), items: []Item{item}}
	if err := os.MkdirAll(a.cacheDir, 0700); err != nil {
		t.Fatal(err)
	}
	_, target := a.thumbnailPath(item)
	if err := os.WriteFile(target, []byte("stale thumbnail"), 0600); err != nil {
		t.Fatal(err)
	}
	a.regenerateThumbnails()
	f, err := os.Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, _, err := image.Decode(f); err != nil {
		t.Fatalf("regenerated thumbnail is not a valid image: %v", err)
	}
	if a.thumbnailing || a.thumbDone != 1 || a.thumbTotal != 1 || a.thumbErrors != 0 {
		t.Fatalf("unexpected regeneration progress: running=%v done=%d total=%d errors=%d",
			a.thumbnailing, a.thumbDone, a.thumbTotal, a.thumbErrors)
	}
}

func TestMissingFFmpegIsReportedByBulkThumbnailGeneration(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NAS_PHOTO_FFMPEG", filepath.Join(dir, "missing-ffmpeg"))
	item := Item{
		ID: "video", Path: filepath.Join(dir, "source.mp4"), Name: "source.mp4",
		Kind: "video", Size: 1, Modified: time.Now(),
	}
	a := &app{cacheDir: filepath.Join(dir, "cache"), items: []Item{item}, log: slog.Default()}
	if err := os.MkdirAll(a.cacheDir, 0700); err != nil {
		t.Fatal(err)
	}
	a.generateMissingThumbnails()
	if a.thumbDone != 1 || a.thumbTotal != 1 || a.thumbErrors != 1 {
		t.Fatalf("missing FFmpeg was not counted: done=%d total=%d errors=%d", a.thumbDone, a.thumbTotal, a.thumbErrors)
	}
	if len(a.thumbErrorDetails) != 1 || !strings.Contains(a.thumbErrorDetails[0], "NAS_PHOTO_FFMPEG") {
		t.Fatalf("missing FFmpeg reason was not retained: %#v", a.thumbErrorDetails)
	}
}

func TestThumbnailFailuresAreShownInGallery(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"monitorScan(state.galleryToken, false, true)",
		"progress.thumbnailErrorDetails",
		"function showThumbnailResult(progress)",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("thumbnail result feedback is missing %q", feature)
		}
	}
}

func TestThumbnailCleanupRemovesOnlyUnusedJPEGs(t *testing.T) {
	dir := t.TempDir()
	cache := filepath.Join(dir, "cache")
	if err := os.MkdirAll(cache, 0700); err != nil {
		t.Fatal(err)
	}
	item := Item{ID: "image", Size: 123, Modified: time.Unix(0, 456)}
	valid := thumbnailKey(item)
	for name, content := range map[string]string{
		valid: "valid", "obsolete.jpg": "old", "leave.txt": "other",
	} {
		if err := os.WriteFile(filepath.Join(cache, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	a := &app{cacheDir: cache, items: []Item{item}, thumbnailCleaning: true}
	a.cleanupThumbnails()
	if _, err := os.Stat(filepath.Join(cache, valid)); err != nil {
		t.Fatalf("valid thumbnail was removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cache, "obsolete.jpg")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("obsolete thumbnail was not removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cache, "leave.txt")); err != nil {
		t.Fatalf("non-thumbnail cache file was removed: %v", err)
	}
	if a.thumbnailCleaning || a.thumbCleanupDone != 2 || a.thumbCleanupTotal != 2 || a.thumbCleanupRemoved != 1 || a.thumbCleanupErrors != 0 {
		t.Fatalf("unexpected cleanup state: running=%v done=%d total=%d removed=%d errors=%d",
			a.thumbnailCleaning, a.thumbCleanupDone, a.thumbCleanupTotal, a.thumbCleanupRemoved, a.thumbCleanupErrors)
	}
}

func TestThumbnailCleanupIsAvailableInScanMenu(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"cleanupThumbnails:'不要なサムネイルを調査して削除'",
		"'/api/thumbnails/cleanup'",
		"progress.thumbnailCleaning",
		"function showThumbnailCleanupResult(progress)",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("thumbnail cleanup UI is missing %q", feature)
		}
	}
}

func TestDefaultSplitToggleShortcut(t *testing.T) {
	if got := defaults()["splitToggle"]; got != "KeyE" {
		t.Fatalf("unexpected split toggle shortcut: %q", got)
	}
}

func TestWebShellDeclaresSVGIcon(t *testing.T) {
	index, err := assets.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(index), `rel="icon" href="/icon.svg" type="image/svg+xml"`) {
		t.Fatal("web shell does not declare the SVG favicon")
	}
	icon, err := assets.ReadFile("web/icon.svg")
	if err != nil {
		t.Fatal(err)
	}
	for _, feature := range []string{`linearGradient id="sky"`, `circle cx="200"`, `clipPath id="frame"`} {
		if !strings.Contains(string(icon), feature) {
			t.Fatalf("SVG icon is missing %q", feature)
		}
	}
}

func TestDefaultMuteShortcut(t *testing.T) {
	if got := defaults()["mute"]; got != "KeyM" {
		t.Fatalf("unexpected mute shortcut: %q", got)
	}
}

func TestStoreLoadAddsNewShortcutDefaults(t *testing.T) {
	file := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(file, []byte(`{"shortcuts":{"prev1":"KeyZ"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	s := &store{file: file}
	if err := s.load(); err != nil {
		t.Fatal(err)
	}
	if s.Shortcuts["prev1"] != "KeyZ" {
		t.Fatalf("existing shortcut was not preserved: %#v", s.Shortcuts)
	}
	if s.Shortcuts["splitToggle"] != "KeyE" {
		t.Fatalf("new shortcut default was not added: %#v", s.Shortcuts)
	}
	if s.Shortcuts["mute"] != "KeyM" {
		t.Fatalf("new mute shortcut default was not added: %#v", s.Shortcuts)
	}
}

func TestWebDefaultsToEnglishWithoutSetupStepCounters(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	if !strings.Contains(source, "localStorage.getItem('nas-photo-language') || 'en'") {
		t.Fatal("web UI does not default to English")
	}
	if strings.Contains(source, `class="step"`) {
		t.Fatal("setup step counters are still rendered")
	}
	if !strings.Contains(source, `id="default-shortcuts"`) {
		t.Fatal("shortcut defaults button is missing")
	}
}

func TestEmptyGalleryDoesNotRestartScanMonitor(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	if strings.Contains(source, "else if (state.total === 0)") {
		t.Fatal("an empty gallery still restarts itself from the scan monitor")
	}
	if !strings.Contains(source, "else if (observedRunning)") ||
		!strings.Contains(source, "await refreshGalleryItems()") {
		t.Fatal("gallery is not refreshed once after an observed scan finishes")
	}
}

func TestViewerKeepsGalleryMountedWhenOpenedAndClosed(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	if !strings.Contains(source, "app.append(layer)") ||
		!strings.Contains(source, "layer.className = 'viewer-layer'") {
		t.Fatal("viewer is not layered over the existing gallery")
	}
	leaveStart := strings.Index(source, "function leaveViewer()")
	paneStart := strings.Index(source, "function paneHTML(")
	if leaveStart < 0 || paneStart <= leaveStart {
		t.Fatal("could not locate viewer close implementation")
	}
	leaveSource := source[leaveStart:paneStart]
	if strings.Contains(leaveSource, "showGallery()") {
		t.Fatal("closing the viewer still reloads the gallery")
	}
	if !strings.Contains(leaveSource, "window.scrollTo(0, scrollY)") {
		t.Fatal("closing the viewer does not restore the gallery scroll position")
	}
}

func TestRiverGalleryDoesNotRelayoutForEveryThumbnail(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	if !strings.Contains(source, "renderTiles(offset > 0)") ||
		!strings.Contains(source, "gallery.insertAdjacentHTML('beforeend'") {
		t.Fatal("additional media pages still rebuild the existing gallery")
	}
	if !strings.Contains(source, "gallery.classList.contains('river-pending')") ||
		!strings.Contains(source, "gallery.classList.remove('river-pending')") {
		t.Fatal("initial river layout is not hidden until its dimensions are ready")
	}
	updateStart := strings.Index(source, "const updateRatio = () =>")
	if updateStart < 0 {
		t.Fatal("could not locate thumbnail ratio handling")
	}
	errorStart := strings.Index(source[updateStart:], "image.addEventListener('error'")
	if errorStart < 0 {
		t.Fatal("could not locate thumbnail ratio handling")
	}
	updateSource := source[updateStart : updateStart+errorStart]
	if strings.Contains(updateSource, "scheduleRiverLayout()") {
		t.Fatal("each thumbnail still triggers a visible river relayout")
	}
	styles, err := assets.ReadFile("web/style.css")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(styles), "scrollbar-gutter: stable") {
		t.Fatal("scrollbar appearance can still change the river layout width")
	}
	if !strings.Contains(source, "const knownRatio = item.kind === 'video'") ||
		!strings.Contains(source, "tile.dataset.kind !== 'video'") {
		t.Fatal("video tiles are not kept square in the river layout")
	}
}

func TestGalleryAutomaticallyLoadsEveryMediaPage(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	if strings.Contains(source, `id="load-more"`) {
		t.Fatal("manual load-more control is still rendered")
	}
	if !strings.Contains(source, "void loadRemainingPages(token)") ||
		!strings.Contains(source, "while (token === state.galleryToken && state.nextOffset >= 0)") {
		t.Fatal("gallery does not automatically continue through media pages")
	}
	if !strings.Contains(source, "while (!next && delta > 0 && state.nextOffset >= 0)") {
		t.Fatal("viewer navigation does not continue across an unloaded page boundary")
	}
}

func TestViewerSwipeFollowsPointerAndSettles(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, expected := range []string{
		`class="swipe-track"`,
		`const GESTURE_AXIS_HYSTERESIS = 10`,
		`const GESTURE_VELOCITY_SAMPLE_MS = 50`,
		`function projectGestureVelocity(`,
		`function startGestureSpring(`,
		`pane.addEventListener('pointermove'`,
		`requestAnimationFrame(paintPending)`,
		`translate3d(calc(-100% + ${offset}px), 0, 0)`,
		`const projectedOffset = displayedOffset + projectGestureVelocity(releaseVelocity.x)`,
		`const distanceThreshold = clampValue(pane.clientWidth * 0.2, 50, 225)`,
		`move(index, direction, displayedOffset + direction * pane.clientWidth, releaseVelocity.x)`,
		`displayedOffset = readOffset()`,
		`pane.addEventListener('pointerdown', clearViewerClickSuppression, true)`,
		`isPointOutsideDisplayedImage(pane, image, state.zoom[index], event.clientX, event.clientY)`,
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("viewer swipe is missing %q", expected)
		}
	}
	styles, err := assets.ReadFile("web/style.css")
	if err != nil {
		t.Fatal(err)
	}
	styleSource := string(styles)
	if !strings.Contains(styleSource, ".swipe-track.is-dragging, .swipe-track.is-settling") {
		t.Fatal("viewer swipe does not expose drag/settle state")
	}
	if strings.Contains(styleSource, ".swipe-track.is-settling {\n  transition: transform") {
		t.Fatal("viewer swipe still uses fixed-duration CSS settling instead of gesture spring physics")
	}
	previewStart := strings.Index(source, "function swipePreviewHTML(")
	bindPaneStart := strings.Index(source, "function bindPane(")
	if previewStart < 0 || bindPaneStart <= previewStart {
		t.Fatal("could not locate viewer swipe preview implementation")
	}
	previewSource := source[previewStart:bindPaneStart]
	for _, expected := range []string{`data-media-width=`, `data-media-height=`, `function containedMediaSize(`, `function fitSwipePreviews(pane)`, `fitSwipePreviews(pane);`} {
		if !strings.Contains(source, expected) {
			t.Fatalf("adjacent preview does not reuse viewer contain sizing: missing %q", expected)
		}
	}
	if !strings.Contains(source, "return `/api/media/${item.id}/thumbnail") ||
		!strings.Contains(previewSource, `const source = mediaThumbnailURL(item)`) ||
		strings.Contains(previewSource, `/content`) {
		t.Fatal("adjacent swipe previews still load full-resolution image content")
	}
	previewStyleStart := strings.Index(styleSource, ".swipe-preview {")
	previewPlayStart := strings.Index(styleSource, ".swipe-preview-play {")
	if previewStyleStart < 0 || previewPlayStart <= previewStyleStart {
		t.Fatal("could not locate adjacent swipe preview sizing")
	}
	previewStyle := styleSource[previewStyleStart:previewPlayStart]
	for _, expected := range []string{"width: auto", "height: auto", "max-width: 100%", "max-height: 100%", "object-fit: contain", "object-position: center center"} {
		if !strings.Contains(previewStyle, expected) {
			t.Fatalf("adjacent swipe preview sizing is missing %q", expected)
		}
	}
}

func TestViewerZoomUsesGestureLocationAndSupportsPanning(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, expected := range []string{
		`const DOUBLE_TAP_IMAGE_ZOOM = 2.5`,
		`const GESTURE_LOWER_ZOOM_FRICTION = 0.15`,
		`const GESTURE_UPPER_ZOOM_FRICTION = 0.05`,
		`const WHEEL_ZOOM_SENSITIVITY = 0.0025`,
		`function imageZoomAtPoint(`,
		`function normalizedWheelDelta(`,
		`pane.addEventListener('wheel'`,
		`Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)`,
		`{passive:false}`,
		`function toggleImageZoomAt(`,
		`function animateImageZoomTo(`,
		`x: clientX - centerX - (clientX - centerX - zoom.x) * ratio`,
		`mode = 'pinch'`,
		`mode = canSwipeFromZoomEdge ? 'swipe' : 'pan'`,
		`queueZoom({`,
		`settleImageZoom(pane, image, index, true, releaseVelocity)`,
		`panStart.x >= bounds.x - 0.5`,
		`panStart.x <= -bounds.x + 0.5`,
		`function suppressNextViewerClick()`,
		`requestAnimationFrame(constrainVisibleViewerZoom)`,
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("viewer zoom is missing %q", expected)
		}
	}
	if strings.Count(source, "suppressNextViewerClick();") < 5 {
		t.Fatal("viewer does not consistently suppress clicks after drag gestures finish")
	}
	styles, err := assets.ReadFile("web/style.css")
	if err != nil {
		t.Fatal(err)
	}
	styleSource := string(styles)
	if !strings.Contains(styleSource, ".zoomable.is-zoomed") ||
		!strings.Contains(styleSource, "touch-action: none") {
		t.Fatal("viewer zoom does not expose draggable image styling or reserve touch gestures")
	}
}

func TestViewerKeepsThumbnailUntilFullImageIsDecoded(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, expected := range []string{
		`class="viewer-image-stage"`,
		`class="media viewer-image-placeholder"`,
		`class="media zoomable viewer-image-full"`,
		`function revealFullViewerImage(image)`,
		`image.decode?.().then(reveal, reveal)`,
		`stage.classList.add('is-loaded')`,
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("viewer image transition is missing %q", expected)
		}
	}
	styles, err := assets.ReadFile("web/style.css")
	if err != nil {
		t.Fatal(err)
	}
	styleSource := string(styles)
	if strings.Contains(styleSource, ".viewer-image-stage.is-loaded .viewer-image-placeholder") {
		t.Fatal("viewer placeholder fades out while the full image fades in, which can darken the image")
	}
	for _, expected := range []string{
		`--nas-gallery-image-reveal-duration: 140ms`,
		`transition: opacity var(--nas-gallery-image-reveal-duration) ease-out`,
		`.viewer-image-stage.is-loaded .viewer-image-full { opacity: 1; }`,
	} {
		if !strings.Contains(styleSource, expected) {
			t.Fatalf("viewer-only image reveal is missing %q", expected)
		}
	}
	sharedMediaStart := strings.Index(styleSource, ".viewer-image-stage > .media {")
	placeholderStart := strings.Index(styleSource, ".viewer-image-placeholder {")
	if sharedMediaStart < 0 || placeholderStart <= sharedMediaStart {
		t.Fatal("could not locate shared viewer image sizing")
	}
	sharedMediaStyle := styleSource[sharedMediaStart:placeholderStart]
	if !strings.Contains(sharedMediaStyle, "width: 100%") ||
		!strings.Contains(sharedMediaStyle, "height: 100%") ||
		!strings.Contains(sharedMediaStyle, "object-fit: contain") {
		t.Fatal("thumbnail and full image do not share the same contain area")
	}
	if !strings.Contains(source, "function containedImageSize(pane, image)") ||
		!strings.Contains(source, "function isPointOutsideDisplayedImage(") ||
		!strings.Contains(source, "const width = rendered.width * zoom.scale") {
		t.Fatal("zoom bounds do not use the contained image dimensions")
	}
}

func TestViewerReusesAdjacentPreviewWithoutDarkGap(t *testing.T) {
	content, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(content)
	for _, expected := range []string{
		`function takeViewerSwipePreview(paneIndex, delta)`,
		`preview.remove()`,
		`function installRetainedViewerPreview(root, preview)`,
		`placeholder.replaceWith(preview)`,
		`const retainedPreview = next.kind === 'video' ? null : takeViewerSwipePreview(paneIndex, delta)`,
		`openViewer(next.id, paneIndex, swipeOffset, swipeVelocity, retainedPreview)`,
		`image.addEventListener('transitionend', onRevealEnd)`,
		`setTimeout(removePlaceholder, GALLERY_IMAGE_REVEAL_MS + 100)`,
	} {
		if !strings.Contains(source, expected) {
			t.Fatalf("viewer preview handoff is missing %q", expected)
		}
	}
}

func TestMakeImageThumbnail(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.jpg")
	target := filepath.Join(dir, "thumb.jpg")
	img := image.NewRGBA(image.Rect(0, 0, 1200, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 1200; x++ {
			img.Set(x, y, color.RGBA{R: 70, G: 120, B: 190, A: 255})
		}
	}
	file, err := os.Create(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, img, nil); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	width, height := mediaDimensions(source, "image")
	if width != 1200 || height != 600 {
		t.Fatalf("unexpected source dimensions: %dx%d", width, height)
	}
	if err := makeImageThumbnail(source, target); err != nil {
		t.Fatal(err)
	}
	thumb, err := os.Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer thumb.Close()
	config, err := jpeg.DecodeConfig(thumb)
	if err != nil {
		t.Fatal(err)
	}
	if config.Width != 480 || config.Height != 240 {
		t.Fatalf("unexpected thumbnail size: %dx%d", config.Width, config.Height)
	}
}
func TestMaterialTooltipDoesNotBreakViewerOpen(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"function hideTooltip()",
		"tooltip.dataset.nasPhotoTooltip = 'true'",
		"document.body.append(tooltip)",
		"function openViewer(id, paneIndex = 0, swipeOffset = 0, swipeVelocity = 0, retainedPreview = null)",
		"hideTooltip();",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("M3E tooltip/viewer integration is missing %q", feature)
		}
	}
}

func TestValidRootsPreservingKeepsExistingIDs(t *testing.T) {
	base := t.TempDir()
	first := filepath.Join(base, "first")
	second := filepath.Join(base, "second")
	if err := os.MkdirAll(first, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(second, 0o755); err != nil {
		t.Fatal(err)
	}
	a := &app{allowed: []string{base}}
	existing := []Root{{ID: "keep-me", Path: first, Name: "first"}}
	roots, err := a.validRootsPreserving([]string{first, second}, existing)
	if err != nil {
		t.Fatal(err)
	}
	if len(roots) != 2 {
		t.Fatalf("got %d roots, want 2", len(roots))
	}
	if roots[0].ID != "keep-me" {
		t.Fatalf("existing root ID changed to %q", roots[0].ID)
	}
	if roots[1].ID == "" || roots[1].ID == "keep-me" {
		t.Fatalf("new root ID is invalid: %q", roots[1].ID)
	}
}

func TestDialogLifecycleSeparatesOpenFromRender(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"function createMaterialDialogShell(",
		"function renderMaterialDialog(",
		"function openMaterialDialog(dialog)",
		"function openSettingsDialog()",
		"function renderSettingsHome(dialog)",
		"$('#settings').onclick = openSettingsDialog;",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("dialog lifecycle is missing %q", feature)
		}
	}
	if strings.Contains(source, "function showSettingsHome(dialog = null)") {
		t.Fatal("settings open and internal navigation must not share the same function")
	}
	settingsStart := strings.Index(source, "function renderSettingsHome(dialog)")
	settingsEnd := strings.Index(source, "let tooltipSerial = 0;")
	if settingsStart < 0 || settingsEnd <= settingsStart {
		t.Fatal("settings render section not found")
	}
	if strings.Contains(source[settingsStart:settingsEnd], "openMaterialDialog(") {
		t.Fatal("internal settings navigation must never reopen the dialog")
	}
}

func TestDialogInternalNavigationKeepsStableShell(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"dialog.innerHTML = `<span slot=\"header\" class=\"dialog-shell-header\"></span>",
		"content.innerHTML = body;",
		"actionBar.innerHTML = actions;",
		"candidate.selected = candidate.dataset.language === draft",
		"candidate.selected = candidate.dataset.value === button.dataset.value",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("stable dialog update is missing %q", feature)
		}
	}
}

func TestSettingsStayInsideMaterialDialog(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"function openSettingsDialog()",
		"$('#settings').onclick = openSettingsDialog;",
		"createMaterialDialogShell('option-dialog settings-dialog'",
		"function renderSettingsDialog(dialog, title, body, actions, singleActions = false)",
		"renderShortcutSettings(dialog)",
		"renderRootSettings(dialog)",
		"renderLanguageSettings(dialog)",
		"renderResetSettings(dialog)",
		"function renderResetConfirmation(dialog, password)",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("settings dialog flow is missing %q", feature)
		}
	}
	if strings.Contains(source, `<main class="page settings">`) {
		t.Fatal("settings still replace the gallery with a full-page settings screen")
	}
}

func TestDialogSingleSelectUsesBeforeInput(t *testing.T) {
	sourceBytes, err := assets.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, feature := range []string{
		"button.onbeforeinput = event => {",
		"event.preventDefault();",
		"candidate.selected = candidate.dataset.value === button.dataset.value",
		"candidate.selected = candidate.dataset.language === draft",
	} {
		if !strings.Contains(source, feature) {
			t.Fatalf("dialog single-select control is missing %q", feature)
		}
	}
}

func TestSettingsResetUsesErrorFilledButtonTokens(t *testing.T) {
	cssBytes, err := assets.ReadFile("web/m3e-overrides.css")
	if err != nil {
		t.Fatal(err)
	}
	css := string(cssBytes)
	for _, feature := range []string{
		`.settings-dialog-item.danger {`,
		`--m3e-filled-button-container-color: var(--md-sys-color-error`,
		`--m3e-filled-button-label-text-color: var(--md-sys-color-on-error`,
	} {
		if !strings.Contains(css, feature) {
			t.Fatalf("settings reset error styling is missing %q", feature)
		}
	}
}
