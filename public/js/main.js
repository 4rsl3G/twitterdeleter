const burger = document.getElementById("navBurger");
const mobileNav = document.getElementById("navMobile");
if (burger && mobileNav) {
  burger.addEventListener("click", () => {
    burger.classList.toggle("active");
    mobileNav.classList.toggle("open");
  });
}

// ── Animated counters (hero) ──
function animateCounter(el, target, duration = 1500) {
  const start = performance.now();
  const update = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

const stat0 = document.getElementById("stat-0");
const stat1 = document.getElementById("stat-1");
const stat2 = document.getElementById("stat-2");

if (stat0) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        animateCounter(stat0, 1000);
        animateCounter(stat1, 100);
        if (stat2) stat2.textContent = "0";
        observer.disconnect();
      }
    });
  });
  observer.observe(stat0);
}

// ── Cursor glow effect ──
const glow = document.createElement("div");
glow.style.cssText = `
  position:fixed; width:300px; height:300px; border-radius:50%;
  background:radial-gradient(circle, rgba(255,45,85,0.04), transparent 70%);
  pointer-events:none; z-index:1; transition:transform 0.1s ease;
  transform:translate(-50%,-50%);
`;
document.body.appendChild(glow);

let mouseX = 0, mouseY = 0;
document.addEventListener("mousemove", (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  glow.style.left = mouseX + "px";
  glow.style.top = mouseY + "px";
});

// ── Feature card stagger reveal ──
const cards = document.querySelectorAll(".feature-card");
if (cards.length) {
  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        entry.target.style.animation = `cardIn 0.5s ease ${i * 0.08}s both`;
        cardObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  cards.forEach((c) => {
    c.style.opacity = "0";
    cardObserver.observe(c);
  });
}
