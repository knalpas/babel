const puppeteer = require('puppeteer');
const target = process.argv[2];
const base = /^https?:/.test(target) ? target : 'file://' + target;
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const errs = [];
  async function open(q, vp = { width: 1440, height: 900 }) {
    const p = await b.newPage();
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        const t = m.text();
        if (!/TUNNEL|fonts|favicon/.test(t)) errs.push(t);
      }
    });
    await p.setViewport(vp);
    await p.goto(base + q, { waitUntil: 'load' });
    await wait(900);
    return p;
  }
  // Current pan/zoom of the tree drawing: { x, y, k }.
  const tf = (p) => p.$eval('.tree__svg > g', (e) => {
    const m = /translate\(([-\d.e]+),([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(e.getAttribute('transform'));
    return m ? { x: +m[1], y: +m[2], k: +m[3] } : { x: 0, y: 0, k: 1 };
  });
  const yearText = (p) => p.$eval('.timeline__year', (e) => e.textContent);
  const panelTitle = (p) => p.$eval('.panel__title', (e) => e.textContent).catch(() => null);
  const search = async (p, q) => {
    await p.click('#language-search');
    await p.keyboard.down('Control');
    await p.keyboard.press('KeyA');
    await p.keyboard.up('Control');
    await p.keyboard.press('Backspace');
    await p.type('#language-search', q);
    await wait(200);
  };

  try {
    // 1. Default load
    let p = await open('');
    ok('loads tree at 1000', (await yearText(p)) === '1000');
    ok('tree renders all 248 rows', (await p.$$eval('.name', (r) => r.length)) === 248);
    ok('tree fits all of history on a desktop screen', await p.evaluate(() => {
      const r = document.querySelector('.tree__svg > g').getBoundingClientRect();
      return r.width <= window.innerWidth + 1;
    }));

    // 2. Search
    await search(p, 'gael');
    const opts = await p.$$eval('.search__results .search__name', (e) => e.map((x) => x.textContent));
    ok('search finds Scottish Gaelic', opts.includes('Scottish Gaelic'), opts.join(', '));
    await p.keyboard.press('Enter');
    await wait(900);
    ok('Enter selects first result', (await panelTitle(p)) === opts[0]);
    await search(p, 'suomi');
    ok('search by native name (Suomi → Finnish)', (await p.$$eval('.search__results .search__name', (e) => e.map((x) => x.textContent))).includes('Finnish'));
    await search(p, 'cataln');
    ok('search with no match shows nothing', (await p.$$('.search__results')).length === 0);

    // 3. Picking a dead language moves the year into its lifetime
    await search(p, 'hittite');
    await p.keyboard.press('Enter');
    await wait(900);
    const y = await yearText(p);
    ok('picking Hittite jumps year into its lifetime', /BC/.test(y), y);

    // 4. Panel navigation
    await p.evaluate(() => [...document.querySelectorAll('.lineage button')].at(-1).click());
    await wait(700);
    ok('descent link opens parent', (await panelTitle(p)) === 'Proto-Anatolian');
    await p.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => c.textContent.includes('Luwian')).click());
    await wait(700);
    ok('daughter chip opens Luwian', (await panelTitle(p)) === 'Luwian');
    await p.click('.panel__close');
    await wait(300);
    ok('close button closes panel', !(await p.$('.panel')));

    // 5. Click a row in the tree
    await p.evaluate(() => {
      const r = [...document.querySelectorAll('.name')].find((g) => g.querySelector('.name__text').textContent === 'English');
      r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await wait(500);
    ok('clicking a tree row selects it', (await panelTitle(p)) === 'English');
    ok('contact arcs drawn (3 for English)', (await p.$$eval('.contact-arc', (a) => a.length)) === 3);
    ok('unrelated rows are dimmed', (await p.$$eval('.name.is-dim', (a) => a.length)) > 100);

    // 6. Pan, zoom, folding
    const tb = await (await p.$('.tree')).boundingBox();
    const t0 = await tf(p);
    await p.mouse.move(tb.x + 300, tb.y + 300);
    await p.mouse.wheel({ deltaY: 600 });
    await wait(300);
    const t1 = await tf(p);
    ok('mouse wheel scrolls the tree down', t1.y < t0.y - 200, `${t0.y} → ${t1.y}`);
    const t15 = await tf(p);
    await p.mouse.move(tb.x + 500, tb.y + 400);
    await p.mouse.down();
    await p.mouse.move(tb.x + 650, tb.y + 250, { steps: 6 });
    await p.mouse.up();
    await wait(200);
    const t2 = await tf(p);
    ok('dragging pans both ways', t2.x > t15.x + 100 && t2.y < t15.y - 100, `${JSON.stringify(t15)} → ${JSON.stringify(t2)}`);
    await p.mouse.wheel({ deltaY: -100000 });
    await wait(300);
    ok('panning stops at the top of the tree', Math.abs((await tf(p)).y - 32) < 12, 'y ' + (await tf(p)).y);
    await p.mouse.wheel({ deltaX: -100000 });
    await wait(300);
    ok('panning stops at 4500 BC', (await tf(p)).x <= 16 && (await tf(p)).x > -2, 'x ' + (await tf(p)).x);
    ok('axis stays pinned at the top', await p.$eval('.tree__axis', (e) => Math.abs(e.getBoundingClientRect().top - e.parentElement.getBoundingClientRect().top) < 2));
    const n0 = await p.$$eval('.name', (r) => r.length);
    await p.evaluate(() => [...document.querySelectorAll('.section__btn')].find((b) => b.textContent.includes('Hellenic')).click());
    await wait(300);
    const n1 = await p.$$eval('.name', (r) => r.length);
    ok('folding a family hides its rows', n1 < n0, `${n0} → ${n1}`);
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Fold all').click());
    await wait(300);
    ok('Fold all leaves only headers', (await p.$$eval('.name', (r) => r.length)) === 0);
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Unfold all').click());
    await wait(300);
    ok('Unfold all restores rows', (await p.$$eval('.name', (r) => r.length)) === 248);
    // Indo-European is drawn as the trunk all its branches grow from.
    ok('Indo-European header counts the whole family', await p.evaluate(() => {
      const h = [...document.querySelectorAll('.section__head')].find((e) => e.textContent.includes('Indo-European'));
      return !!h && /136/.test(h.textContent) && /family/i.test(h.textContent);
    }));
    ok('a trunk joins Proto-Indo-European to all 10 branches', (await p.$$('.trunk')).length === 1 && (await p.$$('.trunk__branch')).length === 10);
    await p.evaluate(() => [...document.querySelectorAll('.section__btn')].find((b) => b.textContent.includes('Indo-European')).click());
    await wait(300);
    ok('folding Indo-European folds all 11 of its bands', (await p.$$('.section__btn.is-collapsed')).length === 11 && (await p.$$('.trunk__branch')).length === 0);
    await p.evaluate(() => [...document.querySelectorAll('.section__btn')].find((b) => b.textContent.includes('Indo-European')).click());
    await wait(300);
    ok('unfolding Indo-European brings them all back', (await p.$$('.section__btn.is-collapsed')).length === 0 && (await p.$$('.trunk__branch')).length === 10);
    const k0 = (await tf(p)).k;
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Zoom in"]').click());
    await wait(500);
    ok('+ zooms in', (await tf(p)).k > k0 * 1.3, `${k0} → ${(await tf(p)).k}`);
    const tz = await tf(p);
    await p.mouse.move(tb.x + 300, tb.y + 300);
    await p.mouse.wheel({ deltaX: 300 });
    await wait(300);
    ok('sideways wheel / trackpad pans in time', (await tf(p)).x < tz.x - 100, `${tz.x} → ${(await tf(p)).x}`);
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Zoom out"]').click());
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Zoom out"]').click());
    await wait(500);
    ok('− zooms out', (await tf(p)).k < k0);
    await p.mouse.move(tb.x + 600, tb.y + 400);
    await p.keyboard.down('Control');
    await p.mouse.wheel({ deltaY: -200 });
    await p.keyboard.up('Control');
    await wait(300);
    ok('ctrl + wheel zooms', (await tf(p)).k > k0 * 0.8);
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Fit').click());
    await wait(600);
    ok('Fit shows all of history', await p.evaluate(() => document.querySelector('.tree__svg > g').getBoundingClientRect().width <= window.innerWidth + 2));
    const fromName = await p.evaluate(() => {
      const b = document.querySelector('.section__from');
      b.click();
      return b.textContent.replace(/^from /, '');
    });
    await wait(700);
    ok('“from …” link opens the parent', (await panelTitle(p)) === fromName, fromName);
    await p.evaluate(() => {
      const r = [...document.querySelectorAll('.name')].find((g) => g.querySelector('.name__text').textContent === 'English');
      r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await wait(400);

    // 7. Timeline
    const box = await (await p.$('.timeline__track')).boundingBox();
    await p.mouse.move(box.x + box.width * 0.1, box.y + 20);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width * 0.3, box.y + 20, { steps: 5 });
    await p.mouse.up();
    await wait(300);
    const y2 = await yearText(p);
    ok('dragging the timeline changes year', /BC/.test(y2), y2);
    await p.focus('.timeline__track');
    await p.keyboard.press('End');
    await wait(200);
    ok('End jumps to 2026', (await yearText(p)) === '2026');
    await p.keyboard.press('Home');
    await wait(200);
    ok('Home jumps to 4500 BC', (await yearText(p)) === '4500 BC');
    await p.keyboard.press('ArrowRight');
    await wait(150);
    ok('arrow key steps forward', (await yearText(p)) === '4450 BC', await yearText(p));
    await p.click('.play');
    await wait(1200);
    const y3 = await yearText(p);
    await p.click('.play');
    ok('play advances time', y3 !== '4450 BC', y3);
    await p.focus('.timeline__track');
    await p.keyboard.press('End');
    await p.click('.timeline__steps button[aria-label="Earlier"]');
    await wait(150);
    ok('Earlier button steps back', (await yearText(p)) === '2021');

    // 8. Word trace
    await p.select('#word-select', 'mother');
    await wait(300);
    const words = await p.$$eval('.name__word', (w) => w.map((x) => x.textContent));
    ok('word trace labels shown', words.length > 80, words.length + ' labels');
    ok('German “Mutter” shown', words.includes('Mutter'));
    ok('URL reflects state', /word=mother/.test(p.url()) && /lang=english/.test(p.url()), p.url().split('?')[1]);

    // 9. Map view
    await p.evaluate(() => [...document.querySelectorAll('.seg__btn')].find((b) => b.textContent === 'Map').click());
    await wait(1000);
    ok('map view renders', !!(await p.$('.map__svg')));
    ok('selection kept across views', (await panelTitle(p)) === 'English');
    ok('lineage path drawn on globe', !!(await p.$('.map__lineage')));
    ok('word labels on globe', (await p.$$eval('.label.is-word', (l) => l.length)) > 5);
    const dots1 = await p.$$eval('.map__dots .dot', (d) => d.length);
    const land1 = await p.$eval('.map__land', (e) => e.getAttribute('d').slice(0, 80));
    const mb = await (await p.$('.map__svg')).boundingBox();
    await p.mouse.move(mb.x + 400, mb.y + 400);
    await p.mouse.down();
    await p.mouse.move(mb.x + 600, mb.y + 420, { steps: 8 });
    await p.mouse.up();
    await wait(300);
    const land2 = await p.$eval('.map__land', (e) => e.getAttribute('d').slice(0, 80));
    ok('dragging the globe rotates it', land1 !== land2);
    await p.focus('.timeline__track');
    await p.keyboard.press('Home');
    await wait(300);
    const dots2 = await p.$$eval('.map__dots .dot', (d) => d.length);
    ok('fewer languages on the globe at 4500 BC', dots2 < dots1, `${dots1} → ${dots2}`);
    await p.keyboard.press('End');
    await wait(300);
    await p.click('.panel__close');
    await wait(200);
    await p.evaluate(() => document.querySelector('.map__dots .dot').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await wait(500);
    ok('clicking a globe dot opens its panel', !!(await panelTitle(p)), await panelTitle(p));
    await p.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('tree')).click());
    await wait(900);
    ok('“Show in the tree” switches view', !!(await p.$('.tree__svg')));

    // 10. About dialog
    await p.click('.icon-btn');
    await wait(200);
    ok('about dialog opens', !!(await p.$('.about__card')));
    await p.keyboard.press('Escape');
    await wait(200);
    ok('Escape closes about', !(await p.$('.about__card')));
    await p.close();

    // 11. Permalinks
    p = await open('?year=44bc&lang=latin&view=map');
    ok('?year=44bc parses', (await yearText(p)) === '44 BC');
    ok('?lang and ?view parse', (await panelTitle(p)) === 'Latin' && !!(await p.$('.map__svg')));
    await p.close();
    p = await open('?year=banana&lang=klingon');
    ok('bad params fall back safely', (await yearText(p)) === '1000' && !(await p.$('.panel')));
    await p.close();

    // 12. Every language opens without errors
    p = await open('');
    const ids = await p.evaluate(() => [...document.querySelectorAll('.name')].length);
    let opened = 0;
    for (let i = 0; i < ids; i++) {
      await p.evaluate((i) => document.querySelectorAll('.name')[i].dispatchEvent(new MouseEvent('click', { bubbles: true })), i);
      if (await p.$('.panel__title')) opened++;
    }
    ok('every language opens a panel', opened === ids, `${opened}/${ids}`);
    ok('every living language has a leaf', (await p.$$eval('.bar.is-living .bar__leaf', (l) => l.length)) === 127);
    await p.close();

    // 13. Phone
    p = await open('?lang=swahili', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok('phone: no horizontal page scroll', sw <= 390, 'scrollWidth ' + sw);
    ok('phone: panel is a bottom sheet', (await p.$eval('.panel', (e) => getComputedStyle(e).left)) === '0px');
    const tl = await (await p.$('.timeline')).boundingBox();
    ok('phone: timeline fully on screen', tl.y + tl.height <= 845);
    await wait(500);
    ok('phone: selected row brought into view', await p.evaluate(() => {
      const t = document.querySelector('.name.is-selected .name__text');
      const r = t && t.getBoundingClientRect();
      return !!r && r.top > 150 && r.top < 844 && r.left > -5 && r.left < 390;
    }));
    await p.close();

    // 14. Fresh phone load: real finger gestures.
    p = await open('?year=1000', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const cdp = await p.createCDPSession();
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const swipe = async ([x0, y0], [x1, y1]) => {
      void 0;
      await touch('touchStart', [[x0, y0]]);
      for (let i = 1; i <= 12; i++) await touch('touchMove', [[x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12]]);
      await touch('touchEnd', []);
      await wait(300);
    };
    const pinch = async (gap0, gap1, y = 600, cx = 195) => {
      await touch('touchStart', [[cx - gap0 / 2, y], [cx + gap0 / 2, y]]);
      for (let i = 1; i <= 10; i++) {
        const g = gap0 + ((gap1 - gap0) * i) / 10;
        await touch('touchMove', [[cx - g / 2, y], [cx + g / 2, y]]);
      }
      await touch('touchEnd', []);
      await wait(300);
    };
    const f0 = await tf(p);
    ok('phone: opens readable (100 %) and wider than the screen', f0.k === 1 && (await p.evaluate(() => document.querySelector('.tree__svg > g').getBoundingClientRect().width)) > 390 * 2.5);
    await swipe([320, 520], [60, 520]);
    const f1 = await tf(p);
    ok('phone: swipe left moves later in time', f1.x < f0.x - 150, `${f0.x} → ${f1.x}`);
    await swipe([60, 520], [320, 520]);
    const f2 = await tf(p);
    ok('phone: swipe right moves earlier in time', f2.x > f1.x + 150, `${f1.x} → ${f2.x}`);
    await swipe([200, 700], [200, 300]);
    const f3 = await tf(p);
    ok('phone: swipe up scrolls down the families', f3.y < f2.y - 200, `${f2.y} → ${f3.y}`);
    await swipe([300, 700], [100, 400]);
    const f4 = await tf(p);
    ok('phone: diagonal swipe pans both ways at once', f4.x < f3.x - 100 && f4.y < f3.y - 150);
    const ab = await (await p.$('.tree__axis')).boundingBox();
    await swipe([60, 520], [340, 520]);
    await swipe([60, 520], [340, 520]);
    await wait(1200);
    const yA = await yearText(p);
    const fa = await tf(p);
    await swipe([300, ab.y + 15], [100, ab.y + 15]);
    ok('phone: swiping across the axis pans, year unchanged', (await yearText(p)) === yA && (await tf(p)).x < fa.x - 100, `${fa.x.toFixed(0)} → ${(await tf(p)).x.toFixed(0)}`);
    await wait(2500); // let the swipe's glide finish: a tap during a glide only stops it
    await p.touchscreen.tap(200, ab.y + 15);
    await wait(300);
    ok('phone: tapping the axis sets the year', (await yearText(p)) !== yA, await yearText(p));
    await pinch(200, 60);
    const g1 = await tf(p);
    ok('phone: pinch in zooms out', g1.k < 0.6, 'k ' + g1.k.toFixed(2));
    await pinch(200, 60);
    await pinch(200, 60);
    ok('phone: can zoom out to see all of history', await p.evaluate(() => document.querySelector('.tree__svg > g').getBoundingClientRect().width <= 390));
    await pinch(60, 250);
    ok('phone: pinch out zooms back in', (await tf(p)).k > g1.k);
    ok('phone: pinch never zooms the page itself', await p.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1) === 1));
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Fit').click());
    await wait(600);
    ok('phone: Fit shows all of history', await p.evaluate(() => document.querySelector('.tree__svg > g').getBoundingClientRect().width <= 392));
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Zoom in"]').click());
    await wait(500);
    ok('phone: + zooms in after Fit', (await tf(p)).k > 0.4);
    ok('phone: zoom buttons on screen', await p.evaluate(() => {
      const r = document.querySelector('.tree__tools').getBoundingClientRect();
      return r.left >= 0 && r.right <= 390;
    }));
    // No wobble: during a drag, family headers stay locked to the tree, and a
    // name pinned to the left edge holds still instead of stepping.
    await wait(2500);
    const lock = [];
    await touch('touchStart', [[200, 640]]);
    for (let i = 1; i <= 14; i++) {
      await touch('touchMove', [[200 - i * 9, 640 - i * 7]]);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      lock.push(await p.evaluate(() => {
        const heads = [...document.querySelectorAll('.section__head')];
        const rules = [...document.querySelectorAll('.section__rule')];
        // Header top versus the section's own rule line, drawn inside the tree.
        const out = [];
        for (const h of heads) {
          const label = h.querySelector('.section__label').textContent;
          const r = rules.map((l) => l.getBoundingClientRect().top).sort((a, b) => Math.abs(a - h.getBoundingClientRect().top) - Math.abs(b - h.getBoundingClientRect().top))[0];
          if (r != null) out.push(h.getBoundingClientRect().top - r);
        }
        const pinned = {};
        for (const t of document.querySelectorAll('.name__text')) {
          const x = t.getBoundingClientRect().left;
          if (x > -50 && x < 60) pinned[t.textContent] = x;
        }
        return { d: out[0], pinned };
      }));
    }
    await touch('touchEnd', []);
    const ds = lock.map((l) => l.d).filter((d) => d != null);
    ok('no wobble: headers stay locked to the tree while dragging', ds.length > 5 && Math.max(...ds) - Math.min(...ds) < 1.01, ds.map((d) => d.toFixed(1)).join(','));
    // Names that are pinned (sitting at the left edge) in two frames in a row
    // must not move between those frames.
    let pinnedPairs = 0;
    let worst = 0;
    for (let i = 1; i < lock.length; i++) {
      for (const [name, xNow] of Object.entries(lock[i].pinned)) {
        const xPrev = lock[i - 1].pinned[name];
        if (xPrev == null) continue;
        // Pinned in both frames (a name arriving at the edge may still move
        // the last fraction of a step, which is correct).
        if (Math.abs(xPrev - 10) < 0.35 && Math.abs(xNow - 10) < 0.35) {
          pinnedPairs++;
          worst = Math.max(worst, Math.abs(xNow - xPrev));
        }
      }
    }
    ok('no wobble: names pinned to the left edge hold still', pinnedPairs > 5 && worst < 0.6, `${pinnedPairs} pinned pairs, worst move ${worst.toFixed(2)}px`);

    // Inertia: a quick flick keeps gliding after the finger lifts, then stops.
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Fit').click());
    await wait(500);
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Zoom in"]').click());
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Zoom in"]').click());
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Zoom in"]').click());
    await wait(500);
    const flick = async (dx, dy) => {
      await touch('touchStart', [[200, 600]]);
      for (let i = 1; i <= 6; i++) {
        await touch('touchMove', [[200 + (dx * i) / 6, 600 + (dy * i) / 6]]);
        await wait(12);
      }
      await touch('touchEnd', []);
    };
    await flick(0, -150);
    const i0 = await tf(p);
    await wait(450);
    const i1 = await tf(p);
    ok('phone: flick keeps gliding after the finger lifts (inertia)', i1.y < i0.y - 40, `${i0.y.toFixed(0)} → ${i1.y.toFixed(0)}`);
    await wait(1800);
    const i2 = await tf(p);
    await wait(300);
    ok('phone: the glide slows to a stop', Math.abs((await tf(p)).y - i2.y) < 1);
    await flick(0, -150);
    await wait(60);
    await touch('touchStart', [[200, 600]]);
    await wait(30);
    const s0 = await tf(p);
    await wait(300);
    await touch('touchEnd', []);
    ok('phone: touching again stops the glide', Math.abs((await tf(p)).y - s0.y) < 1);
    // Tapping on a language to stop a glide must not open that language.
    await p.evaluate(() => document.querySelector('.panel__close')?.click());
    await flick(0, -150);
    await wait(80);
    const nb = await p.evaluate(() => {
      const r = [...document.querySelectorAll('.name__text')].map((e) => e.getBoundingClientRect()).find((r) => r.top > 300 && r.top < 700 && r.left > 0 && r.right < 390);
      return r ? [r.left + 8, r.top + r.height / 2] : null;
    });
    if (nb) await p.touchscreen.tap(nb[0], nb[1]);
    await wait(300);
    ok('phone: a tap that stops a glide does not open a language', nb && !(await p.$('.panel')));
    if (nb) await p.touchscreen.tap(nb[0], nb[1]);
    await wait(400);
    ok('phone: a tap when still opens the language', !!(await p.$('.panel')));
    await p.evaluate(() => document.querySelector('.panel__close')?.click());
    await wait(200);
    const kq = (await tf(p)).k;
    // Double tap on an empty spot, away from any name or header.
    const spot = await p.evaluate(() => {
      for (let y = 380; y < 720; y += 14) for (let x = 120; x < 380; x += 14) {
        const e = document.elementFromPoint(x, y);
        if (e && !e.closest('.name, .section__head, .panel, .tree__tools, .tree__axis') && e.closest('.tree')) return [x, y];
      }
      return [300, 700];
    });
    await p.touchscreen.tap(spot[0], spot[1]);
    await wait(80);
    await p.touchscreen.tap(spot[0], spot[1]);
    await wait(400);
    const kd = (await tf(p)).k;
    ok('phone: double tap does not zoom', Math.abs(kd - kq) < 0.001, `${kq.toFixed(2)} → ${kd.toFixed(2)}`);
    await p.evaluate(() => document.querySelector('.panel__close')?.click());
    await wait(200);
    // Go to the 'today' end first, so there is room to glide back in time.
    for (let n = 0; n < 3; n++) { await flick(-300, 0); await wait(800); }
    const s1 = await tf(p);
    await flick(120, 0);
    const s2 = await tf(p);
    await wait(500);
    const i3 = await tf(p);
    ok('phone: sideways flick glides through time too', i3.x > s2.x + 30 && i3.x > s1.x + 120, `${s1.x.toFixed(0)} → ${s2.x.toFixed(0)} → ${i3.x.toFixed(0)}`);
    for (let n = 0; n < 4; n++) {
      await flick(0, 260);
      await wait(700);
    }
    ok('phone: a glide stops at the top, first family below the date bar', await p.evaluate(() => {
      const head = document.querySelector('.section__head');
      const axis = document.querySelector('.tree__axis').getBoundingClientRect();
      return head && head.getBoundingClientRect().top >= axis.bottom - 1 && head.textContent.includes('Indo-European');
    }));
    ok('phone: axis labels never pile up', await p.evaluate(() => {
      const xs = [...document.querySelectorAll('.tree__axis text')].map((t) => t.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      const shown = xs.filter((r) => r.right > 0 && r.left < 390);
      return shown.every((r, i) => i === 0 || r.left >= shown[i - 1].right - 1) && shown.every((r) => r.left >= 0 && r.right <= 390);
    }));
    await wait(2500); // let the last glide settle
    const hb = await (await p.$('.section__btn')).boundingBox();
    await p.touchscreen.tap(hb.x + 10, hb.y + hb.height / 2);
    await wait(300);
    ok('phone: family header still taps to fold', (await p.$eval('.section__btn', (b) => b.getAttribute('aria-expanded'))) === 'false');
    await p.touchscreen.tap(hb.x + 10, hb.y + hb.height / 2);
    await wait(300);
    await swipe([350, 600], [40, 600]);
    await swipe([350, 600], [40, 600]);
    await swipe([350, 600], [40, 600]);
    await swipe([350, 600], [40, 600]);
    const edgeInfo = await p.evaluate(() => {
      const t = document.querySelector('.axis__tick:last-of-type, .tree__axis g.axis__tick:nth-last-of-type(1)');
      const today = [...document.querySelectorAll('.tree__axis .axis__tick text')].find((e) => e.textContent === 'Today');
      return today ? Math.round(today.getBoundingClientRect().left) : null;
    });
    ok('phone: swiping stops at today, never into empty space', edgeInfo != null && edgeInfo > 200 && edgeInfo < 390, 'Today label at x=' + edgeInfo);
    await p.close();
  } catch (e) {
    results.push('FAIL  test crashed: ' + e.message);
  }

  for (const r of results) console.log(r);
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  console.log('console errors/warnings:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  await b.close();
})();
