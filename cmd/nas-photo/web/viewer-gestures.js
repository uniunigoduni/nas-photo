function bindSwipe(pane, index) {
  fitSwipePreviews(pane);
  const track = $('.swipe-track', pane);
  const image = $('.swipe-slide-current .zoomable', pane);
  const previousAvailable = $('.swipe-slide-previous', pane)?.dataset.available === 'true';
  const nextAvailable = $('.swipe-slide-next', pane)?.dataset.available === 'true';
  const pointers = new Map();
  let primaryPointerId = null;
  let mode = 'idle';
  let dragAxis = null;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let displayedOffset = Number(state.swipeOffset[index]) || 0;
  const initialSettleVelocity = Number(state.swipeVelocity[index]) || 0;
  let panStart = null;
  let pinchStart = null;
  let lastTap = null;
  let suppressDblClickUntil = 0;
  let trackSpringCancel = null;
  let gestureFrame = 0;
  let pendingOffset = null;
  let pendingZoom = null;
  let sampleTime = 0;
  let sampleX = 0;
  let sampleY = 0;
  const velocity = {x:0, y:0};

  const setOffsetNow = offset => {
    track.style.transform = `translate3d(calc(-100% + ${offset}px), 0, 0)`;
  };
  const paintPending = () => {
    gestureFrame = 0;
    if (pendingOffset !== null) {
      setOffsetNow(pendingOffset);
      pendingOffset = null;
    }
    if (pendingZoom && image) {
      applyImageZoom(image, pendingZoom);
      pendingZoom = null;
    }
  };
  const schedulePaint = () => {
    if (!gestureFrame) gestureFrame = requestAnimationFrame(paintPending);
  };
  const queueOffset = offset => {
    displayedOffset = offset;
    pendingOffset = offset;
    schedulePaint();
  };
  const queueZoom = zoom => {
    state.zoom[index] = zoom;
    pendingZoom = {...zoom};
    schedulePaint();
  };
  const flushPaint = () => {
    if (gestureFrame) cancelAnimationFrame(gestureFrame);
    if (gestureFrame || pendingOffset !== null || pendingZoom) paintPending();
  };
  const readOffset = () => {
    const transform = getComputedStyle(track).transform;
    if (!transform || transform === 'none') return 0;
    try {
      return new DOMMatrixReadOnly(transform).m41 + pane.clientWidth;
    } catch {
      return displayedOffset;
    }
  };
  const stopTrackSpring = () => {
    trackSpringCancel?.();
    trackSpringCancel = null;
    track.classList.remove('is-settling');
  };
  const springTrackTo = (target, releaseVelocity = 0) => {
    flushPaint();
    stopTrackSpring();
    track.classList.remove('is-dragging');
    track.classList.add('is-settling');
    const springStart = displayedOffset;
    trackSpringCancel = startGestureSpring({
      start: springStart,
      end: target,
      velocity: releaseVelocity,
      dampingRatio: 1,
      naturalFrequency: GESTURE_SWIPE_SPRING_FREQUENCY,
      onUpdate: offset => {
        if (!track.isConnected) {
          stopTrackSpring();
          return;
        }
        displayedOffset = offset;
        setOffsetNow(offset);
      },
      onComplete: () => {
        displayedOffset = target;
        setOffsetNow(target);
        track.classList.remove('is-settling');
        trackSpringCancel = null;
      }
    });
  };
  const settleTrack = (releaseVelocity = 0) => springTrackTo(0, releaseVelocity);
  const capturePointer = pointerId => {
    try { pane.setPointerCapture?.(pointerId); } catch {}
  };
  const pointerPair = () => [...pointers.values()].slice(0, 2);
  const midpoint = pair => ({
    x: (pair[0].x + pair[1].x) / 2,
    y: (pair[0].y + pair[1].y) / 2
  });
  const distance = pair => Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);

  const resetVelocity = (x, y) => {
    sampleX = x;
    sampleY = y;
    sampleTime = performance.now();
    velocity.x = 0;
    velocity.y = 0;
  };
  const sampleVelocity = (x, y, force = false) => {
    const now = performance.now();
    const elapsed = now - sampleTime;
    if (!force && elapsed < GESTURE_VELOCITY_SAMPLE_MS) return;
    velocity.x = Math.abs(x - sampleX) > 1 && elapsed > 5 ? (x - sampleX) / elapsed : 0;
    velocity.y = Math.abs(y - sampleY) > 1 && elapsed > 5 ? (y - sampleY) / elapsed : 0;
    sampleX = x;
    sampleY = y;
    sampleTime = now;
  };

  const beginPinch = () => {
    const pair = pointerPair();
    if (!image || pair.length < 2) return;
    flushPaint();
    stopTrackSpring();
    state.zoomAnimationCancel[index]?.();
    state.zoomAnimationCancel[index] = null;
    displayedOffset = 0;
    setOffsetNow(0);
    const middle = midpoint(pair);
    pinchStart = {
      distance: Math.max(1, distance(pair)),
      midpoint: middle,
      zoom: {...state.zoom[index]}
    };
    mode = 'pinch';
    dragAxis = null;
    suppressNextViewerClick();
    pointers.forEach((_, pointerId) => capturePointer(pointerId));
  };
  const updatePinch = () => {
    const pair = pointerPair();
    if (!image || pair.length < 2 || !pinchStart) return;
    const middle = midpoint(pair);
    const rawScale = pinchStart.zoom.scale * distance(pair) / pinchStart.distance;
    const scale = rawScale < 1
      ? 1 - (1 - rawScale) * GESTURE_LOWER_ZOOM_FRICTION
      : rawScale > MAX_IMAGE_ZOOM
      ? MAX_IMAGE_ZOOM + (rawScale - MAX_IMAGE_ZOOM) * GESTURE_UPPER_ZOOM_FRICTION
      : rawScale;
    const rect = pane.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const contentX = (pinchStart.midpoint.x - centerX - pinchStart.zoom.x) / pinchStart.zoom.scale;
    const contentY = (pinchStart.midpoint.y - centerY - pinchStart.zoom.y) / pinchStart.zoom.scale;
    const bounds = imageZoomBounds(pane, image, scale);
    queueZoom({
      scale,
      x: resistBound(middle.x - centerX - contentX * scale, bounds.x),
      y: resistBound(middle.y - centerY - contentY * scale, bounds.y)
    });
  };
  const continueWithRemainingPointer = () => {
    const remaining = pointers.entries().next().value;
    if (!remaining || !image) return;
    primaryPointerId = remaining[0];
    startX = remaining[1].x;
    startY = remaining[1].y;
    startOffset = displayedOffset = 0;
    panStart = {...state.zoom[index]};
    mode = 'pending';
    dragAxis = null;
    resetVelocity(startX, startY);
  };

  state.swipeOffset[index] = 0;
  state.swipeVelocity[index] = 0;
  if (displayedOffset) {
    setOffsetNow(displayedOffset);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (primaryPointerId === null) settleTrack(initialSettleVelocity);
    }));
  }
  if (image) {
    state.zoom[index] = clampImageZoom(pane, image, state.zoom[index]);
    applyImageZoom(image, state.zoom[index]);
    revealFullViewerImage(image);
    image.addEventListener('load', () => settleImageZoom(pane, image, index, false), {once:true});
    image.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < suppressDblClickUntil) return;
      flushPaint();
      stopTrackSpring();
      displayedOffset = 0;
      setOffsetNow(0);
      toggleImageZoomAt(pane, image, index, event.clientX, event.clientY);
    });
    image.addEventListener('contextmenu', event => {
      event.preventDefault();
      animateImageZoomTo(pane, image, index, {scale:1, x:0, y:0}, {
        naturalFrequency: GESTURE_ZOOM_SPRING_FREQUENCY
      });
    });
    pane.addEventListener('wheel', event => {
      if (pointers.size || event.target.closest('.controls, button, m3e-button, m3e-icon-button, video')) return;
      const delta = normalizedWheelDelta(event, pane);
      if (!delta) return;
      event.preventDefault();
      flushPaint();
      stopTrackSpring();
      displayedOffset = 0;
      setOffsetNow(0);
      state.zoomAnimationCancel[index]?.();
      state.zoomAnimationCancel[index] = null;
      const current = state.zoom[index];
      const targetScale = clampValue(current.scale * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), 1, MAX_IMAGE_ZOOM);
      queueZoom(imageZoomAtPoint(pane, image, current, targetScale, event.clientX, event.clientY));
    }, {passive:false});
  }

  pane.addEventListener('pointerdown', event => {
    const media = event.target.closest('.media, .swipe-preview');
    const continuingSettle = Boolean(trackSpringCancel) || track.classList.contains('is-settling');
    if (event.button !== 0 || !media || (!continuingSettle && !media.closest('.swipe-slide-current'))) return;
    const video = event.target.closest('video');
    if (video && event.clientY >= video.getBoundingClientRect().bottom - 64) return;
    flushPaint();
    if (continuingSettle) {
      displayedOffset = readOffset();
      stopTrackSpring();
      setOffsetNow(displayedOffset);
    }
    state.zoomAnimationCancel[index]?.();
    state.zoomAnimationCancel[index] = null;
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY, pointerType:event.pointerType});
    if (image && pointers.size === 2) {
      beginPinch();
      event.preventDefault();
      return;
    }
    if (pointers.size > 1) return;
    primaryPointerId = event.pointerId;
    mode = 'pending';
    dragAxis = null;
    startOffset = displayedOffset;
    startX = event.clientX;
    startY = event.clientY;
    panStart = image ? {...state.zoom[index]} : null;
    resetVelocity(startX, startY);
  });

  pane.addEventListener('pointermove', event => {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (mode === 'pinch') {
      updatePinch();
      event.preventDefault();
      return;
    }
    if (event.pointerId !== primaryPointerId || mode === 'ignored') return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (mode === 'pending') {
      if (Math.hypot(dx, dy) < GESTURE_AXIS_HYSTERESIS) return;
      dragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (image && state.zoom[index].scale > 1.001) {
        const bounds = imageZoomBounds(pane, image, state.zoom[index].scale);
        const touchLike = event.pointerType !== 'mouse';
        const canSwipeFromZoomEdge = dragAxis === 'x' && touchLike && (
          (dx > 0 && previousAvailable && panStart.x >= bounds.x - 0.5) ||
          (dx < 0 && nextAvailable && panStart.x <= -bounds.x + 0.5)
        );
        mode = canSwipeFromZoomEdge ? 'swipe' : 'pan';
      } else {
        mode = dragAxis === 'x' ? 'swipe' : 'ignored';
      }
      if (mode === 'ignored') return;
      suppressNextViewerClick();
      capturePointer(event.pointerId);
      if (mode === 'swipe') track.classList.add('is-dragging');
      startX = event.clientX;
      startY = event.clientY;
      startOffset = displayedOffset;
      panStart = image ? {...state.zoom[index]} : null;
      resetVelocity(startX, startY);
      event.preventDefault();
      return;
    }
    sampleVelocity(event.clientX, event.clientY);
    if (mode === 'pan' && image && panStart) {
      const bounds = imageZoomBounds(pane, image, state.zoom[index].scale);
      queueZoom({
        scale: state.zoom[index].scale,
        x: resistBound(panStart.x + (event.clientX - startX), bounds.x),
        y: resistBound(panStart.y + (event.clientY - startY), bounds.y)
      });
      event.preventDefault();
      return;
    }
    if (mode !== 'swipe') return;
    const swipeDx = event.clientX - startX;
    const atEdge = (swipeDx > 0 && !previousAvailable) || (swipeDx < 0 && !nextAvailable);
    queueOffset(startOffset + (atEdge ? swipeDx * GESTURE_END_FRICTION : swipeDx));
    event.preventDefault();
  });

  pane.addEventListener('pointerup', event => {
    if (!pointers.has(event.pointerId)) return;
    if (event.pointerId === primaryPointerId && mode !== 'pinch') {
      sampleVelocity(event.clientX, event.clientY, true);
    }
    pointers.delete(event.pointerId);
    flushPaint();
    if (mode === 'pinch') {
      suppressNextViewerClick();
      if (pointers.size) {
        continueWithRemainingPointer();
      } else if (image) {
        primaryPointerId = null;
        settleImageZoom(pane, image, index, true);
        mode = 'idle';
        dragAxis = null;
      }
      event.preventDefault();
      return;
    }
    if (event.pointerId !== primaryPointerId) return;
    primaryPointerId = null;
    const releaseVelocity = {...velocity};
    if (mode === 'swipe') {
      suppressNextViewerClick();
      const projectedOffset = displayedOffset + projectGestureVelocity(releaseVelocity.x);
      const distanceThreshold = clampValue(pane.clientWidth * 0.2, 50, 225);
      const velocityCommit = Math.abs(releaseVelocity.x) >= GESTURE_MIN_SWIPE_SPEED
        && Math.abs(displayedOffset) >= GESTURE_AXIS_HYSTERESIS;
      const distanceCommit = Math.abs(projectedOffset) >= distanceThreshold;
      const directionSource = velocityCommit ? releaseVelocity.x : projectedOffset;
      const direction = velocityCommit || distanceCommit ? (directionSource < 0 ? 1 : -1) : 0;
      const canMove = direction < 0 ? previousAvailable : direction > 0 ? nextAvailable : false;
      if (canMove) {
        stopTrackSpring();
        track.classList.remove('is-dragging');
        move(index, direction, displayedOffset + direction * pane.clientWidth, releaseVelocity.x);
      } else {
        settleTrack(releaseVelocity.x);
      }
      event.preventDefault();
    } else if (mode === 'pan' && image) {
      suppressNextViewerClick();
      settleImageZoom(pane, image, index, true, releaseVelocity);
      event.preventDefault();
    } else if (mode === 'pending' && image && event.pointerType === 'touch') {
      const now = performance.now();
      if (lastTap && now - lastTap.time <= DOUBLE_TAP_DELAY &&
          Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_DISTANCE) {
        stopTrackSpring();
        displayedOffset = 0;
        setOffsetNow(0);
        toggleImageZoomAt(pane, image, index, event.clientX, event.clientY);
        suppressNextViewerClick();
        suppressDblClickUntil = now + 500;
        lastTap = null;
        event.preventDefault();
      } else {
        lastTap = {time:now, x:event.clientX, y:event.clientY};
      }
    }
    mode = 'idle';
    dragAxis = null;
  });

  pane.addEventListener('pointercancel', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.clear();
    primaryPointerId = null;
    flushPaint();
    if (mode === 'swipe') settleTrack(velocity.x);
    if ((mode === 'pan' || mode === 'pinch') && image) settleImageZoom(pane, image, index, true, velocity);
    mode = 'idle';
    dragAxis = null;
  });
}

