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
    ok('tree renders all 248 rows', (await p.$$eval('.row', (r) => r.length)) === 248);

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
      const r = [...document.querySelectorAll('.row')].find((g) => g.querySelector('.row__name').textContent === 'English');
      r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await wait(500);
    ok('clicking a tree row selects it', (await panelTitle(p)) === 'English');
    ok('contact arcs drawn (3 for English)', (await p.$$eval('.contact-arc', (a) => a.length)) === 3);
    ok('unrelated rows are dimmed', (await p.$$eval('.row.is-dim', (a) => a.length)) > 100);

    // 6. Tree pans with wheel
    const g1 = await p.$eval('.tree__svg > g', (e) => e.getAttribute('transform'));
    const tb = await (await p.$('.tree__svg')).boundingBox();
    await p.mouse.move(tb.x + 300, tb.y + 300);
    await p.mouse.wheel({ deltaY: 400 });
    await wait(300);
    const g2 = await p.$eval('.tree__svg > g', (e) => e.getAttribute('transform'));
    ok('wheel pans the tree', g1 !== g2);

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
    const words = await p.$$eval('.row__word', (w) => w.map((x) => x.textContent));
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
    const ids = await p.evaluate(() => [...document.querySelectorAll('.row')].length);
    let opened = 0;
    for (let i = 0; i < ids; i++) {
      await p.evaluate((i) => document.querySelectorAll('.row')[i].dispatchEvent(new MouseEvent('click', { bubbles: true })), i);
      if (await p.$('.panel__title')) opened++;
    }
    ok('every language opens a panel', opened === ids, `${opened}/${ids}`);
    await p.close();

    // 13. Phone
    p = await open('?lang=swahili', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok('phone: no horizontal page scroll', sw <= 390, 'scrollWidth ' + sw);
    ok('phone: panel is a bottom sheet', (await p.$eval('.panel', (e) => getComputedStyle(e).left)) === '0px');
    const tl = await (await p.$('.timeline')).boundingBox();
    ok('phone: timeline fully on screen', tl.y + tl.height <= 845);
    await p.close();
  } catch (e) {
    results.push('FAIL  test crashed: ' + e.message);
  }

  for (const r of results) console.log(r);
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  console.log('console errors/warnings:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  await b.close();
})();
