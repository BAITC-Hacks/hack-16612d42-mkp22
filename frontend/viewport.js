// visualViewport covers mobile keyboards that resize only the visual viewport.
export function observeViewport() {
  const viewport = window.visualViewport;
  let baselineHeight = viewport?.height || window.innerHeight;
  let baselineWidth = window.innerWidth;
  let frame = 0;
  function update() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Preserve browser zoom and pinch-to-zoom instead of fighting its layout.
      if (viewport && viewport.scale > 1.05) return;
      const height = viewport?.height || window.innerHeight;
      if (Math.abs(window.innerWidth - baselineWidth) > 100) {
        baselineHeight = height;
        baselineWidth = window.innerWidth;
      }
      const editable = document.activeElement?.matches('textarea, input:not([type="button"]):not([type="submit"])');
      if (!editable) baselineHeight = Math.max(baselineHeight, height);
      const keyboard = Boolean(editable && window.innerWidth <= 960 && baselineHeight - height > 140);
      document.body.classList.toggle('keyboard-open', keyboard);
      document.documentElement.style.setProperty('--viewport-height', `${height}px`);
      document.documentElement.style.setProperty('--viewport-offset-top', `${viewport?.offsetTop || 0}px`);
    });
  }
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', update);
  update();
  return update;
}
