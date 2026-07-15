import { renderAppNav, mountAppNav } from './app-shell';

const SALES_EMAIL = 'sales@systemdesigngame.com';

export function renderLandingPage(): string {
  return `
    <div class="site-page landing-page">
      ${renderAppNav('home')}
      <main class="landing-main">
        <section class="landing-hero">
          <div class="landing-hero-copy">
            <p class="landing-eyebrow">Interactive system design interviews</p>
            <h1>Practice architecture under real load — before the whiteboard</h1>
            <p class="landing-lead">
              System Design Game lets candidates wire services, run traffic simulations, and learn from
              classic interview problems. Engineering teams use it to standardize interviews and see how
              candidates think in motion.
            </p>
            <div class="landing-cta-row">
              <a class="btn btn-primary btn-lg" href="/challenges" data-link>Browse challenges</a>
              <a class="btn btn-secondary btn-lg" href="/sandbox/url-shortener" data-link>Try it yourself</a>
            </div>
          </div>
          <div class="landing-hero-visual" aria-hidden="true">
            <div class="landing-preview-card">
              <div class="landing-preview-title">Live simulation</div>
              <div class="landing-preview-grid">
                <span>⚖️ LB</span><span>→</span><span>🔧 API</span><span>→</span><span>🗄️ DB</span>
              </div>
              <div class="landing-preview-stats">
                <div><strong>200</strong><span>RPS</span></div>
                <div><strong>99.2%</strong><span>uptime</span></div>
                <div><strong>45s</strong><span>scenario</span></div>
              </div>
            </div>
          </div>
        </section>

        <section class="landing-features">
          <article class="feature-card">
            <h3>Interview-ready challenges</h3>
            <p>URL shortener, feed systems, file storage, rate limiters — each with requirements, video walkthroughs, and a hands-on sandbox.</p>
          </article>
          <article class="feature-card">
            <h3>See traffic, not just boxes</h3>
            <p>Animated requests, spikes, and failures show whether your design survives load — closer to production than static diagrams.</p>
          </article>
          <article class="feature-card">
            <h3>Built for hiring teams</h3>
            <p>Give every interviewer the same scenarios, scoring lens, and candidate experience. Reduce variance across loops.</p>
          </article>
        </section>

        <section class="landing-sales">
          <div class="landing-sales-copy">
            <h2>Hiring at scale?</h2>
            <p>
              We work with companies that run dozens of system design interviews each month.
              Get team seats, custom challenges, SSO, and analytics for your interview pipeline.
            </p>
          </div>
          <div class="landing-sales-actions">
            <a class="btn btn-primary btn-lg" href="mailto:${SALES_EMAIL}?subject=System%20Design%20Game%20for%20our%20interviews">Contact sales</a>
            <a class="btn btn-secondary btn-lg" href="mailto:${SALES_EMAIL}?subject=Schedule%20a%20demo">Schedule a demo</a>
          </div>
        </section>
      </main>
      <footer class="site-footer">
        <p>© ${new Date().getFullYear()} System Design Game · Built for engineers preparing for — and running — interviews.</p>
      </footer>
    </div>
  `;
}

export function mountLandingPage(container: HTMLElement): void {
  container.dataset.activeNav = 'home';
  mountAppNav(container);
}
