/** Negative controls: the overflow detector must report text that is really clipped, and stay quiet for text that fits or scrolls. */
import { expect, test } from '@playwright/test';
import { detectOverflow } from './overflow';

test.describe('overflow detector controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('toolbar')).toBeVisible();
  });

  test('reports ellipsis, hidden overflow, line clipping and text escaping the viewport', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'ctl';
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;width:200px';
      host.innerHTML = [
        '<div id="a" style="width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">转换为关系模式并保留位置</div>',
        '<div id="b" style="width:60px;overflow:hidden;white-space:nowrap">复合外键引用的属性不构成键</div>',
        '<div id="c" style="height:20px;overflow:hidden;line-height:20px">第一行<br>第二行被裁掉</div>',
        '<div id="d" style="position:absolute;left:' + (window.innerWidth - 20) + 'px;top:150px;white-space:nowrap">超出视口的文字</div>',
        '<div id="e" style="width:300px;white-space:nowrap">不会被裁剪的文字</div>',
        '<div id="f" style="width:60px;height:20px;overflow:auto;white-space:nowrap">在滚动容器里的很长的文字</div>',
      ].join('');
      document.body.appendChild(host);
    });
    const found = await detectOverflow(page, '#ctl');
    const texts = found.map((f) => `${f.kind}:${f.text}`);
    expect(texts.some((t) => t.startsWith('clip-x:转换为关系模式'))).toBe(true);
    expect(texts.some((t) => t.startsWith('clip-x:复合外键'))).toBe(true);
    expect(texts.some((t) => t.startsWith('clip-y:第一行'))).toBe(true);
    expect(texts.some((t) => t.includes('超出视口的文字') && t.startsWith('outside-viewport'))).toBe(true);
    expect(texts.some((t) => t.includes('不会被裁剪'))).toBe(false);
    expect(texts.some((t) => t.includes('滚动容器'))).toBe(false);
  });

  test('ignores truncated user data without Chinese characters', async ({ page }) => {
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'ctl2';
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#fff';
      d.textContent = 'PrimaryPhysician – Doctor';
      document.body.appendChild(d);
    });
    expect(await detectOverflow(page, '#ctl2')).toEqual([]);
  });
});
