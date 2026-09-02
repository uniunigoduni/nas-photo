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
		"!dateSort)",
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
		"aria-pressed=\"${selected}\"",
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
		`pane.addEventListener('pointermove'`,
		`translate3d(calc(-100% + ${offset}px), 0, 0)`,
		`const fastSwipe =`,
		`move(index, direction, displayedOffset + direction * pane.clientWidth)`,
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
	if !strings.Contains(string(styles), ".swipe-track.is-settling") {
		t.Fatal("viewer swipe does not animate to its settled position")
	}
	previewStart := strings.Index(source, "function swipePreviewHTML(")
	bindPaneStart := strings.Index(source, "function bindPane(")
	if previewStart < 0 || bindPaneStart <= previewStart {
		t.Fatal("could not locate viewer swipe preview implementation")
	}
	previewSource := source[previewStart:bindPaneStart]
	if !strings.Contains(source, "return `/api/media/${item.id}/thumbnail") ||
		!strings.Contains(previewSource, `const source = mediaThumbnailURL(item)`) ||
		strings.Contains(previewSource, `/content`) {
		t.Fatal("adjacent swipe previews still load full-resolution image content")
	}
	styleSource := string(styles)
	previewStyleStart := strings.Index(styleSource, ".swipe-preview {")
	previewPlayStart := strings.Index(styleSource, ".swipe-preview-play {")
	if previewStyleStart < 0 || previewPlayStart <= previewStyleStart {
		t.Fatal("could not locate adjacent swipe preview sizing")
	}
	previewStyle := styleSource[previewStyleStart:previewPlayStart]
	if !strings.Contains(previewStyle, "width: 100%") ||
		!strings.Contains(previewStyle, "height: 100%") ||
		!strings.Contains(previewStyle, "object-fit: contain") {
		t.Fatal("adjacent swipe preview does not fill the viewer with contain sizing")
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
		`function toggleImageZoomAt(`,
		`x: clientX - centerX - (clientX - centerX - current.x) * ratio`,
		`mode = 'pinch'`,
		`mode = 'pan'`,
		`settleImageZoom(pane, image, index)`,
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
	if !strings.Contains(styleSource, ".viewer-image-stage.is-loaded .viewer-image-placeholder") ||
		!strings.Contains(styleSource, ".viewer-image-stage.is-loaded .viewer-image-full") {
		t.Fatal("viewer image does not cross-fade from thumbnail to decoded full image")
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
