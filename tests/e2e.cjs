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
    ok('tree fits all of history on a desktop screen', await p.$eval('.tree__scroll', (e) => e.scrollWidth <= e.clientWidth + 1));

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

    // 6. Native scrolling, folding, zoom
    const tb = await (await p.$('.tree__scroll')).boundingBox();
    const top0 = await p.$eval('.tree__scroll', (e) => e.scrollTop);
    await p.mouse.move(tb.x + 300, tb.y + 300);
    await p.mouse.wheel({ deltaY: 600 });
    await wait(400);
    ok('mouse wheel scrolls the tree', (await p.$eval('.tree__scroll', (e) => e.scrollTop)) > top0);
    ok('axis stays pinned while scrolling', await p.$eval('.tree__axis', (e) => Math.abs(e.getBoundingClientRect().top - e.parentElement.getBoundingClientRect().top) < 2));
    const n0 = await p.$$eval('.name', (r) => r.length);
    await p.evaluate(() => [...document.querySelectorAll('.section__btn')].find((b) => b.textContent.includes('Germanic')).click());
    await wait(300);
    const n1 = await p.$$eval('.name', (r) => r.length);
    ok('folding Germanic hides its rows', n1 < n0, `${n0} → ${n1}`);
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Fold all').click());
    await wait(300);
    ok('Fold all leaves only headers', (await p.$$eval('.name', (r) => r.length)) === 0);
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Unfold all').click());
    await wait(300);
    ok('Unfold all restores rows', (await p.$$eval('.name', (r) => r.length)) === 248);
    const w0 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Stretch time"]').click());
    await wait(300);
    const w1 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    ok('+ stretches time', w1 > w0 * 1.3, `${w0} → ${w1}`);
    ok('stretched tree scrolls sideways', await p.$eval('.tree__scroll', (e) => e.scrollWidth > e.clientWidth));
    const fs0 = await p.$eval('.name__text', (e) => getComputedStyle(e).fontSize);
    ok('text size unchanged by zoom', fs0 === '15.5px', fs0);
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Fit').click());
    await wait(300);
    ok('Fit returns to full view', (await p.$eval('.tree__svg', (e) => +e.getAttribute('width'))) <= w0 + 1);
    await p.evaluate(() => [...document.querySelectorAll('.section__from')].find((b) => b.closest('.section').textContent.includes('Germanic')).click());
    await wait(600);
    ok('“from …” link opens the parent', (await panelTitle(p)) === 'Proto-Indo-European');
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
    ok('phone: selected row scrolled into view', await p.evaluate(() => {
      const t = [...document.querySelectorAll('.name.is-selected')][0];
      const r = t && t.getBoundingClientRect();
      return !!r && r.top > 0 && r.top < 844 && r.left > -5 && r.left < 390;
    }));
    await p.click('.panel__close');
    await wait(200);
    const pw0 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    ok('phone: opens readable, wider than the screen', pw0 >= 390 * 2.5, 'width ' + pw0);
    // Real two-finger pinch out, via the DevTools touch protocol.
    const cdp = await p.createCDPSession();
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    await touch('touchStart', [[170, 600], [220, 600]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[170 - i * 12, 600], [220 + i * 12, 600]]);
    const mid = await p.evaluate(() => ({
      t: document.querySelector('.tree__body').style.transform,
      w: +document.querySelector('.tree__svg').getAttribute('width'),
    }));
    ok('phone: pinch previews smoothly without re-laying out', /scaleX/.test(mid.t) && mid.w === pw0, mid.t);
    await touch('touchEnd', []);
    await wait(400);
    const pw1 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    ok('phone: preview cleared once the pinch ends', (await p.$eval('.tree__body', (e) => e.style.transform)) === '');
    ok('phone: pinching out stretches time', pw1 > pw0 * 2, `${pw0} → ${pw1}`);
    ok('phone: pinch does not zoom the page', await p.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1) === 1));
    await touch('touchStart', [[80, 600], [310, 600]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[80 + i * 12, 600], [310 - i * 12, 600]]);
    await touch('touchEnd', []);
    await wait(400);
    const pw2 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    ok('phone: pinching in squeezes time again', pw2 < pw1, `${pw1} → ${pw2}`);
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Stretch time"]').click());
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Stretch time"]').click());
    await wait(300);
    for (let i = 0; i < 6; i++) await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Compress time"]').click());
    await wait(300);
    ok('phone: − zooms all the way out to the screen', (await p.$eval('.tree__svg', (e) => +e.getAttribute('width'))) <= 392);
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Stretch time"]').click());
    await wait(300);
    await p.evaluate(() => [...document.querySelectorAll('.tree__tools button')].find((b) => b.textContent === 'Fit').click());
    await wait(300);
    ok('phone: Fit zooms out to the whole tree', (await p.$eval('.tree__svg', (e) => +e.getAttribute('width'))) <= 392);
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Stretch time"]').click());
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Stretch time"]').click());
    await wait(300);
    // A real finger swipe across the tree scrolls it sideways.
    await p.evaluate(() => document.querySelector('.tree__tools button[aria-label="Stretch time"]').click());
    await wait(300);
    await p.evaluate(() => { document.querySelector('.tree__scroll').scrollLeft = 0; });
    await wait(200);
    const sl0 = await p.$eval('.tree__scroll', (e) => e.scrollLeft);
    await touch('touchStart', [[300, 480]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[300 - i * 20, 480]]);
    await touch('touchEnd', []);
    await wait(500);
    ok('phone: finger swipe scrolls the tree sideways', (await p.$eval('.tree__scroll', (e) => e.scrollLeft)) > sl0 + 50);
    // Swiping along the date axis scrolls too, rather than changing the year.
    const yA = await yearText(p);
    const sl1 = await p.$eval('.tree__scroll', (e) => e.scrollLeft);
    const ab = await (await p.$('.tree__axis')).boundingBox();
    await touch('touchStart', [[300, ab.y + 15]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[300 - i * 15, ab.y + 15]]);
    await touch('touchEnd', []);
    await wait(500);
    ok('phone: swiping the axis scrolls and keeps the year', (await yearText(p)) === yA && (await p.$eval('.tree__scroll', (e) => e.scrollLeft)) > sl1, yA + ' → ' + (await yearText(p)));
    await p.touchscreen.tap(200, ab.y + 15);
    await wait(300);
    ok('phone: tapping the axis sets the year', (await yearText(p)) !== yA, await yearText(p));
    await p.evaluate(() => { document.querySelector('.tree__scroll').scrollLeft = 0; });
    await wait(200);
    const sc = await p.$eval('.tree__scroll', (e) => e.scrollLeft);
    await p.evaluate(() => { const e = document.querySelector('.tree__scroll'); e.scrollLeft += 300; });
    await wait(300);
    ok('phone: tree scrolls sideways', (await p.$eval('.tree__scroll', (e) => e.scrollLeft)) > sc);
    ok('phone: names stay readable after sideways scroll', await p.evaluate(() => {
      return [...document.querySelectorAll('.name__text')].every((t) => {
        const r = t.getBoundingClientRect();
        if (r.bottom < 240 || r.top > 1300 || r.right < 0) return true;
        return r.left > -2;
      });
    }));
    // Zoom slider: no gestures needed.
    const setSlider = (v) => p.evaluate((v) => {
      const el = document.querySelector('#tree-zoom');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await setSlider(0);
    await wait(300);
    const zs0 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    await setSlider(700);
    await wait(300);
    const zs1 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    ok('phone: zoom slider out fits the screen, in stretches', zs0 <= 392 && zs1 > zs0 * 3, `${zs0} → ${zs1}`);
    ok('phone: zoom controls fit on screen', await p.evaluate(() => {
      const r = document.querySelector('.tree__tools').getBoundingClientRect();
      return r.left >= 0 && r.right <= 390;
    }));
    await p.close();

    // 14. Fresh phone load: swipe left and right straight away, no zooming.
    p = await open('?year=1000', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const cdp2 = await p.createCDPSession();
    const swipe = async (x0, x1, y) => {
      const pts = (x) => [{ x, y, id: 0 }];
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(x0) });
      for (let i = 1; i <= 12; i++) await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(x0 + ((x1 - x0) * i) / 12) });
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(600);
    };
    const f0 = await p.$eval('.tree__scroll', (e) => e.scrollLeft);
    await swipe(320, 60, 520);
    const f1 = await p.$eval('.tree__scroll', (e) => e.scrollLeft);
    ok('fresh phone: swipe left moves later in time', f1 > f0 + 100, `${f0} → ${f1}`);
    await swipe(60, 320, 520);
    const f2 = await p.$eval('.tree__scroll', (e) => e.scrollLeft);
    ok('fresh phone: swipe right moves earlier in time', f2 < f1 - 100, `${f1} → ${f2}`);
    await p.close();

    // 15. Safari's own pinch events (iPhone / iPad path), simulated.
    p = await b.newPage();
    await p.evaluateOnNewDocument(() => { window.ongesturestart = null; });
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await p.goto(base, { waitUntil: 'load' });
    await wait(900);
    const g0 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    const gesture = (type, scale) => p.evaluate((type, scale) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      ev.scale = scale; ev.clientX = 195;
      document.querySelector('.tree__scroll').dispatchEvent(ev);
      return ev.defaultPrevented;
    }, type, scale);
    const blocked = await gesture('gesturestart', 1);
    await gesture('gesturechange', 0.5);
    await gesture('gesturechange', 0.2);
    ok('Safari pinch: previews while pinching', /scaleX/.test(await p.$eval('.tree__body', (e) => e.style.transform)));
    await gesture('gestureend', 0.2);
    await wait(400);
    const g1 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    ok('Safari pinch: pinching in zooms out to the screen', g1 <= 392 && g1 < g0, `${g0} → ${g1}`);
    ok('Safari pinch: page zoom is blocked', blocked);
    await gesture('gesturestart', 1);
    await gesture('gesturechange', 4);
    await gesture('gestureend', 4);
    await wait(400);
    const g2 = await p.$eval('.tree__svg', (e) => +e.getAttribute('width'));
    ok('Safari pinch: pinching out zooms in', g2 > g1 * 3, `${g1} → ${g2}`);
    await p.close();
  } catch (e) {
    results.push('FAIL  test crashed: ' + e.message);
  }

  for (const r of results) console.log(r);
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  console.log('console errors/warnings:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  await b.close();
})();
