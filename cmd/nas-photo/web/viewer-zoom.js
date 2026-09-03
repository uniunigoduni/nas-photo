function containedMediaSize(containerWidth, containerHeight, naturalWidth, naturalHeight) {
  const width = Math.max(1, Number(naturalWidth) || containerWidth);
  const height = Math.max(1, Number(naturalHeight) || containerHeight);
  const fit = Math.min(containerWidth / width, containerHeight / height);
  return {width:width * fit, height:height * fit};
}

function containedImageSize(pane, image) {
  const placeholder = $('.viewer-image-placeholder', image.closest('.viewer-image-stage'));
  const measurable = image.naturalWidth ? image : placeholder;
  return containedMediaSize(
    pane.clientWidth, pane.clientHeight,
    measurable?.naturalWidth || pane.clientWidth,
    measurable?.naturalHeight || pane.clientHeight
  );
}

function fitSwipePreviews(pane) {
  $$('.swipe-preview', pane).forEach(image => {
    const fit = () => {
      const naturalWidth = Number(image.dataset.mediaWidth) || image.naturalWidth;
      const naturalHeight = Number(image.dataset.mediaHeight) || image.naturalHeight;
      if (!naturalWidth || !naturalHeight || !pane.clientWidth || !pane.clientHeight) return;
      const rendered = containedMediaSize(pane.clientWidth, pane.clientHeight, naturalWidth, naturalHeight);
      image.style.width = `${rendered.width}px`;
      image.style.height = `${rendered.height}px`;
    };
    fit();
    if (!image.complete) image.addEventListener('load', fit, {once:true});
  });
}

function imageZoomBounds(pane, image, scale) {
  const rendered = containedImageSize(pane, image);
  return {
    x: Math.max(0, (rendered.width * scale - pane.clientWidth) / 2),
    y: Math.max(0, (rendered.height * scale - pane.clientHeight) / 2)
  };
}

function isPointOutsideDisplayedImage(pane, image, zoom, clientX, clientY) {
  const rect = pane.getBoundingClientRect();
  const rendered = containedImageSize(pane, image);
  const width = rendered.width * zoom.scale;
  const height = rendered.height * zoom.scale;
  const centerX = rect.left + rect.width / 2 + zoom.x;
  const centerY = rect.top + rect.height / 2 + zoom.y;
  return clientX < centerX - width / 2 || clientX > centerX + width / 2 ||
    clientY < centerY - height / 2 || clientY > centerY + height / 2;
}

function clampValue(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function resistBound(value, limit) {
  if (value > limit) return limit + (value - limit) * GESTURE_END_FRICTION;
  if (value < -limit) return -limit + (value + limit) * GESTURE_END_FRICTION;
  return value;
}

function projectGestureVelocity(velocity, decelerationRate = 0.995) {
  return velocity * decelerationRate / (1 - decelerationRate);
}

function startGestureSpring({start, end, velocity = 0, dampingRatio = 1, naturalFrequency = 30, onUpdate, onComplete}) {
  let position = start;
  let speed = velocity * 1000;
  let frame = 0;
  let previousTime = performance.now();
  let active = true;
  const initialDistance = Math.abs(end - start);
  const positionTolerance = Math.max(0.001, initialDistance * 0.001);
  const speedTolerance = Math.max(0.02, initialDistance * 0.05);

  const step = now => {
    if (!active) return;
    let remaining = Math.min(32, Math.max(0, now - previousTime)) / 1000;
    previousTime = now;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120);
      const displacement = position - end;
      const acceleration = -2 * dampingRatio * naturalFrequency * speed
        - naturalFrequency * naturalFrequency * displacement;
      speed += acceleration * dt;
      position += speed * dt;
      remaining -= dt;
    }
    onUpdate(position);
    if (Math.abs(position - end) <= positionTolerance && Math.abs(speed) <= speedTolerance) {
      onUpdate(end);
      active = false;
      onComplete?.();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  frame = requestAnimationFrame(step);
  return () => {
    active = false;
    cancelAnimationFrame(frame);
  };
}

function clampImageZoom(pane, image, zoom) {
  const scale = clampValue(zoom.scale, 1, MAX_IMAGE_ZOOM);
  const bounds = imageZoomBounds(pane, image, scale);
  return {
    scale,
    x: clampValue(zoom.x, -bounds.x, bounds.x),
    y: clampValue(zoom.y, -bounds.y, bounds.y)
  };
}

function imageZoomAtPoint(pane, image, zoom, targetScale, clientX, clientY) {
  const scale = clampValue(targetScale, 1, MAX_IMAGE_ZOOM);
  if (scale <= 1.001) return {scale:1, x:0, y:0};
  const rect = pane.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const ratio = scale / zoom.scale;
  return clampImageZoom(pane, image, {
    scale,
    x: clientX - centerX - (clientX - centerX - zoom.x) * ratio,
    y: clientY - centerY - (clientY - centerY - zoom.y) * ratio
  });
}

function normalizedWheelDelta(event, pane) {
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1;
  return clampValue(event.deltaY * multiplier, -240, 240);
}

function applyImageZoom(image, zoom) {
  image.classList.toggle('is-zoomed', zoom.scale > 1.001);
  const transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
  image.style.transform = transform;
  const stage = image.closest('.viewer-image-stage');
  const placeholder = stage ? $('.viewer-image-placeholder', stage) : null;
  if (placeholder) placeholder.style.transform = transform;
}

function animateImageZoomTo(pane, image, index, target, options = {}) {
  state.zoomAnimationCancel[index]?.();
  const start = {...state.zoom[index]};
  const distance = {
    scale: target.scale - start.scale,
    x: target.x - start.x,
    y: target.y - start.y
  };
  const velocity = options.velocity || {x:0, y:0};
  const dominantAxis = Math.abs(distance.x) >= Math.abs(distance.y) ? 'x' : 'y';
  const dominantDistance = distance[dominantAxis];
  const progressVelocity = Math.abs(dominantDistance) > 0.5
    ? (velocity[dominantAxis] || 0) / dominantDistance
    : 0;
  const cancel = startGestureSpring({
    start: 0,
    end: 1,
    velocity: progressVelocity,
    dampingRatio: options.dampingRatio ?? 1,
    naturalFrequency: options.naturalFrequency ?? GESTURE_ZOOM_SPRING_FREQUENCY,
    onUpdate: progress => {
      if (!image.isConnected) {
        cancel();
        return;
      }
      state.zoom[index] = {
        scale: start.scale + distance.scale * progress,
        x: start.x + distance.x * progress,
        y: start.y + distance.y * progress
      };
      applyImageZoom(image, state.zoom[index]);
    },
    onComplete: () => {
      state.zoom[index] = {...target};
      applyImageZoom(image, state.zoom[index]);
      state.zoomAnimationCancel[index] = null;
    }
  });
  state.zoomAnimationCancel[index] = cancel;
}

function cssTimeMilliseconds(value) {
  const source = String(value || '').trim();
  if (source.endsWith('ms')) return Math.max(0, Number.parseFloat(source) || 0);
  if (source.endsWith('s')) return Math.max(0, (Number.parseFloat(source) || 0) * 1000);
  return 0;
}

function revealFullViewerImage(image) {
  const stage = image.closest('.viewer-image-stage');
  if (!stage || stage.classList.contains('is-loaded')) return;
  const reveal = () => {
    if (!image.isConnected || !image.naturalWidth) return;
    const placeholder = $('.viewer-image-placeholder', stage);
    if (placeholder) {
      let removed = false;
      const removePlaceholder = () => {
        if (removed) return;
        removed = true;
        image.removeEventListener('transitionend', onRevealEnd);
        placeholder.remove();
      };
      const onRevealEnd = event => {
        if (event.target === image && event.propertyName === 'opacity') removePlaceholder();
      };
      image.addEventListener('transitionend', onRevealEnd);
      setTimeout(removePlaceholder, cssTimeMilliseconds(getComputedStyle(stage).getPropertyValue('--nas-gallery-image-reveal-duration')) + 100);
    }
    stage.classList.add('is-loaded');
  };
  if (image.complete && image.naturalWidth) {
    image.decode?.().then(reveal, reveal);
  } else {
    image.addEventListener('load', () => image.decode?.().then(reveal, reveal) ?? reveal(), {once:true});
  }
}

function settleImageZoom(pane, image, index, animate = true, velocity = {x:0, y:0}) {
  const current = state.zoom[index];
  const projected = current.scale >= 1 && current.scale <= MAX_IMAGE_ZOOM
    ? {
        scale: current.scale,
        x: current.x + projectGestureVelocity(velocity.x || 0),
        y: current.y + projectGestureVelocity(velocity.y || 0)
      }
    : current;
  const target = clampImageZoom(pane, image, projected);
  if (!animate) {
    state.zoomAnimationCancel[index]?.();
    state.zoomAnimationCancel[index] = null;
    state.zoom[index] = target;
    applyImageZoom(image, target);
    return;
  }
  const projectedOutsideBounds = Math.abs(projected.x - target.x) > 0.5 || Math.abs(projected.y - target.y) > 0.5;
  animateImageZoomTo(pane, image, index, target, {
    velocity,
    naturalFrequency: GESTURE_PAN_SPRING_FREQUENCY,
    dampingRatio: projectedOutsideBounds ? 0.82 : 1
  });
}

function toggleImageZoomAt(pane, image, index, clientX, clientY) {
  const current = state.zoom[index];
  let target;
  if (current.scale > 1.001) {
    target = {scale:1, x:0, y:0};
  } else {
    target = imageZoomAtPoint(pane, image, current, DOUBLE_TAP_IMAGE_ZOOM, clientX, clientY);
  }
  animateImageZoomTo(pane, image, index, target, {naturalFrequency: GESTURE_ZOOM_SPRING_FREQUENCY});
}

