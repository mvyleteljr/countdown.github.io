// Live countdown to October 12 (this year or next if passed)
(function(){
  function nextTarget() {
    const now = new Date();
    const year = now.getFullYear();
    const targetThisYear = new Date(year, 9, 12, 0, 0, 0); // Month is 0-based; 9=October
    return (now <= targetThisYear) ? targetThisYear : new Date(year + 1, 9, 12, 0, 0, 0);
  }

  function fmt(msRemaining) {
    if (msRemaining < 0) msRemaining = 0;
    const totalSec = Math.floor(msRemaining / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${days}d ${Utils.pad(hours)}:${Utils.pad(mins)}:${Utils.pad(secs)}`;
  }

  function start() {
    const el = document.getElementById('countdown');
    const targetEl = document.getElementById('targetDate');
    if (!el) return;

    let target = nextTarget();
    targetEl.textContent = `Target: ${target.toDateString()} 00:00:00`;

    function tick() {
      const now = Date.now();
      const remaining = target.getTime() - now;
      el.textContent = fmt(remaining);
      if (remaining <= 0) {
        // roll over to next year automatically
        target = nextTarget();
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

