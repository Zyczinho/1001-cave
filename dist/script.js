document.body.classList.add("js");

const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 },
  );

  revealItems.forEach((item, index) => {
    item.style.transitionDelay = `${Math.min(index % 3, 2) * 70}ms`;
    observer.observe(item);
  });
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const progress = document.querySelector(".progress span");

function updateProgress() {
  const distance = document.documentElement.scrollHeight - window.innerHeight;
  const position = distance > 0 ? window.scrollY / distance : 0;
  progress.style.width = `${Math.min(100, Math.max(0, position * 100))}%`;
}

updateProgress();
window.addEventListener("scroll", updateProgress, { passive: true });

const heroMark = document.querySelector(".hero-mark img");
const canMove = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");

if (heroMark && canMove.matches) {
  window.addEventListener("pointermove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 10;
    const y = (event.clientY / window.innerHeight - 0.5) * 10;
    heroMark.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  });
}
