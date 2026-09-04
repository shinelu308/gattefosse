/**
 * 全站接入 Cookie 管理面板（tarteaucitron）
 * 在每个页面 </body> 前插入：真库引用 + 中文语言初始化 + 面板按钮绑定（幂等）
 * 运行：node backend/scripts/add-cookie-consent.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, '../../site');

const SNIPPET = `
<!-- Cookie 管理面板（tarteaucitron）：库 + 显式初始化（本地无 Drupal behaviors 链） -->
<script src="themes/custom/gattefosse/js/libraries/tarteaucitron/tarteaucitron5fcd.js"></script>
<script>
  window.tarteaucitronForceLanguage = 'zh';
  if (window.tarteaucitron && window.tarteaucitron.init) {
    window.tarteaucitron.init({
      'privacyUrl': '', 'hashtag': '#tarteaucitron', 'cookieName': 'tarteaucitron',
      'orientation': 'bottom', 'closePopup': true, 'showIcon': false, 'iconPosition': 'BottomLeft',
      'adblocker': false, 'DenyAllCta': true, 'AcceptAllCta': true, 'highPrivacy': true,
      'handleBrowserDNTRequest': false, 'removeCredit': true, 'moreInfoLink': true,
      'useExternalCss': false, 'useExternalJs': false, 'readmoreLink': '/cookies', 'mandatory': true
    });
    if (window.jQuery) {
      jQuery(document).on('click', '.cookieOpenDialogBtn', function () {
        tarteaucitron.userInterface.openPanel(); return false;
      });
    }
  }
</script>`;

const SKIP = new Set(['footer.html']);
let added = 0, skipped = 0;

for (const f of fs.readdirSync(SITE)) {
  if (!f.endsWith('.html') || SKIP.has(f)) continue;
  const p = path.join(SITE, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('tarteaucitron5fcd.js') && html.includes("tarteaucitronForceLanguage = 'zh'")) { skipped++; continue; }
  if (!html.includes('</body>')) { console.log('skip(无</body>):', f); continue; }
  // 去掉可能存在的旧 stub 占位（index.html 等），由真库替代
  html = html.replace(/<!-- 占位 tarteaucitron[\s\S]*?<\/script>\n?/, '');
  html = html.replace('</body>', SNIPPET + '\n</body>');
  fs.writeFileSync(p, html);
  added++;
}
console.log(`done: added=${added}, already=${skipped}`);
