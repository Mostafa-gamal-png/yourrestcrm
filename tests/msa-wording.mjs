// The application's Arabic is Modern Standard Arabic (the owner, 2026-11-11: «الكلام فى التطبيق بالفصحى مش مصرى عامى»), without a build:
// every Arabic string literal of app/, lib/, portable/ and components/ (and the JSX text between tags), the Arabic keys of
// lib/locales/en.json and the Arabic of lib/app-update-release.json are read, comments left out (they quote the owner's words), and none
// may hold a word of Egyptian colloquial (مش، اللي، دلوقتي، عايز، إزاي، تاني، ينفعش، بتاع، لسه، علشان، كده، إيه، اللينك ... and the
// colloquial verb forms: the future «هيتبعت»، the progressive «بيوقّع»، the passive «اتعدّل»، the negation «ما اتحفظش»). A string kept as it
// is because it is a stored value or a key the data is matched by is named in ALLOWED with its reason. MSA_REPORT=1 lists every hit
// instead of failing at the first file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

/** The string literals of a JavaScript or TypeScript source (template pieces between their ${...}, and JSX text), without comments: each
 *  with the line it starts on. spans: the lines each literal and each comment covers, so a caller can tell that every line holding Arabic
 *  was read (a lexer gone astray would otherwise skip the rest of a file silently). */
export function stringLiterals(source, spans = []) {
  const out = [];
  let i = 0, line = 1, last = '';
  const n = source.length, ARABIC = /[\u0600-\u06ff]/;
  const push = (text, at) => { spans.push([at, line]); if (ARABIC.test(text)) out.push({text, line: at}); };
  const regexAllowed = () => last !== '<' && (!last || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /^(return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/.test(last));
  function quoted(q) {
    const start = line;let text = '';i++;
    while (i < n && source[i] !== q) {
      if (source[i] === '\\') { text += source[i] + (source[i + 1] || ''); if (source[i + 1] === '\n') line++; i += 2; continue; }
      if (source[i] === '\n') break;
      text += source[i++];
    }
    i++;return {text, start};
  }
  function template() {
    let start = line, text = '';i++;
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') { text += source[i] + (source[i + 1] || ''); if (source[i + 1] === '\n') line++; i += 2; continue; }
      if (source[i] === '$' && source[i + 1] === '{') { push(text, start); text = '{}'; i += 2; code(1); start = line; continue; }
      if (source[i] === '\n') line++;
      text += source[i++];
    }
    i++;push(text, start);last = '`';
  }
  // code(depth): until the brace that closes ${ (depth 1), or the end (depth 0).
  function code(depth) {
    let braces = 0;
    while (i < n) {
      const c = source[i], d = source[i + 1];
      if (c === '\n') { line++; i++; continue; }
      if (c === '/' && d === '/') { while (i < n && source[i] !== '\n') i++; spans.push([line, line]); continue; }
      if (c === '/' && d === '*') { const from = line;i += 2; while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { if (source[i] === '\n') line++; i++; } i += 2; spans.push([from, line]); continue; }
      if (c === '\'' || c === '"') { const {text, start} = quoted(c); push(text, start); last = 'str'; continue; }
      if (c === '`') { template(); continue; }
      // A regular expression; not the «/» of a closing tag («</p>») or of a self-closing one («<br/>»).
      if (c === '/' && d !== '>' && regexAllowed()) {
        i++;let inClass = false;
        while (i < n && source[i] !== '\n') { if (source[i] === '\\') { i += 2; continue; } if (source[i] === '[') inClass = true; else if (source[i] === ']') inClass = false; else if (source[i] === '/' && !inClass) break; i++; }
        i++;while (/[a-z]/i.test(source[i] || '')) i++;spans.push([line, line]);last = 'regex';continue;
      }
      if (ARABIC.test(c)) { // JSX text
        const start = line;let text = '';
        while (i < n && !/[<{}\n]/.test(source[i])) text += source[i++];
        push(text, start);last = 'jsx';continue;
      }
      if (depth && c === '{') braces++;
      if (depth && c === '}') { if (!braces) { i++; return; } braces--; }
      if (/\s/.test(c)) { i++; continue; }
      if (/[A-Za-z0-9_$]/.test(c)) { let word = ''; while (i < n && /[A-Za-z0-9_$]/.test(source[i])) word += source[i++]; last = word; continue; }
      last = c;i++;
    }
  }
  code(0);
  return out;
}
/** The lines holding Arabic that no literal nor comment covers (none, when the lexer read the file through). */
export function unreadArabicLines(source) {
  const spans = [];
  stringLiterals(source, spans);
  const covered = new Set();
  for (const [from, to] of spans) for (let at = from; at <= to; at++) covered.add(at);
  return source.split('\n').map((text, index) => /[\u0600-\u06ff]/.test(text) && !covered.has(index + 1) ? index + 1 : 0).filter(Boolean);
}

const AR = '\\u0621-\\u064a\\u0640\\u064b-\\u0652\\u0670';
const word = list => new RegExp('(?<![' + AR + '])(?:' + list + ')(?![' + AR + '])', 'u');
/** The colloquial words and forms; each is unknown to the written language (or, as «بس» and «لسه», means something else there). */
export const COLLOQUIAL = [
  ['words', word([
    'مش', 'مفيش', 'مافيش', 'اللي', 'اللى', 'دلوقتي', 'دلوقت', 'عايزة?', 'عاوزة?', 'عايزين', 'إزاي', 'ازاي', 'تاني', 'تانية', 'تانيين', 'التانية?',
    'ينفع', 'مينفعش', 'ينفعش', 'ماينفعش', 'بتاع[\u0621-\u064a]*', 'بتوع', 'لسه', 'لسة', 'علشان', 'عشان', 'كده', 'كدا', 'كدة', 'إيه', 'ايه', 'ليه', 'فين',
    'برضه', 'برضو', 'بردو', 'خلاص', 'بقى', 'بقت', 'بقا', 'بقوا', 'أوي', 'اوي', 'خالص', 'حاجة', 'حاجات', 'شوية', 'بس', 'زي', 'زيه', 'زيها',
    'إمتى', 'امتى', 'مين', 'ده', 'دي', 'دول', 'دا', 'كمان', 'إحنا', 'احنا', 'إنت', 'انت', 'إنتي', 'انتي', 'معلش', 'أهو', 'اهو', 'يلا', 'جوه', 'جوا', 'برّه',
    'بره', 'لحد', 'لغاية', 'وبعدين', 'بعدين', 'استنى', 'كتير', 'كتيرة', 'مظبوط', 'مظبوطة', 'بالظبط', 'تتظبط', 'اتظبط', 'سيب', 'سيبه', 'سيبها',
    'ضيفهم', 'النهارده', 'لينك', 'اللينك', 'للينك', 'بالينك', 'لينكات', 'فاضي', 'فاضية', 'فاضلين', 'دايمًا', 'دايما', 'متختار', 'الجداد', 'جداد',
    'أول ما', 'اول ما', 'طول ما', 'قبل ما', 'من غير ما', 'ياخد', 'شغال', 'شغالة', 'مستني',
    'مستنية', 'يشوف', 'تشوف', 'بيشوف', 'شافها', 'شافهوش', 'شاف', 'الاتنين', 'ليها', 'ليهم', 'مالوش', 'فمالوش', 'مالهاش', 'ابعت', 'ابعته', 'ابعتها', 'دوس',
    'بدالهم', 'بدالها', 'اتنسخ', 'اتعمل', 'متسجل[\u0621-\u064a]*', 'متثبت[\u0621-\u064a]*', 'متساب', 'تختارله', 'هتختار[\u0621-\u064a]*', 'بصباع[\u0621-\u064a]*',
    'ما قدرناش', 'قدرناش', 'رجّعك', 'رجّعت', 'رجّع', 'يرجّع', 'ولّا', 'خليك', 'خلّي', 'خلي', 'خليه', 'خليها', 
  ].join('|'))],
  // The future «هيتبعت، هتظهر، هنبعت» and «هيبقى»: ه before the present tense.
  ['future', word('ه(?:ي|ت|ن)(?:ت[\u0621-\u064a]{2,}|بقى|كون|ظهر|رجع|لغي|وصل|حفظ|ضاف|بعت|مسح|غير|تغير|حدث|بدأ|عمل|فتح|قفل|روح|طلع|شيل|ساب|ربط)[\u0621-\u064a]*')],
  // The progressive «بيوقّع، بتتحذف، بنبعت».
  ['progressive', word('(?:و|ف)?ب(?:ي|ت|ن)(?:ت[\u0621-\u064a]{2,}|وقّع|وقع|شوف|حاول|رجع|حسب|بطل|فضل|عمل|حذف|طابق|ظهر|بدأ|وصل|قفل|بعت|حدّث|حدث|طبق|زوّد|زود|سجل|سجّل|يجي|جي)[\u0621-\u064a]*')],
  // The passive with ات «اتعدّل، اتبعت، اتحفظت».
  ['passive', word('(?:و|ف|ل)?ات(?:عدّ?ل|بعت|حفظ|حذف|مسح|ضاف|سجّ?ل|غيّ?ر|فتح|قفل|لغ|نسخ|ربط|طابق|حدّ?ث|ساب|شال|رفض|رفع|قبل|عمل|عرض|حمّ?ل|قر|سترجع|أكد|حط|نقل|بعتت|صدّ?ر|اخد|خد|وزع|قسم|قطع)[\u0621-\u064a]*')],
  // The passive with يت «يتبعت، يتحذف، يتقفل» (the written passive is يُفعَل; «يتم» and the true reflexive verbs are not here).
  ['passive-present', word('(?:و|ف)?(?:ي|ت)ت(?:بعت|حذف|مسح|ضاف|قفل|شال|عمل|حفظ|سجّ?ل|نقل|حط|رفع|عرض|ساب|لغي|ربط|فتح|عدّ?ل|حسب|ظبط)[\u0621-\u064a]*')],
  // The negation «ما اتحفظش، مبيوسّعش، متحذفش، ما بدأش».
  ['negation', word('(?:و|ف)?(?:م|ما)[\u0621-\u064a]{2,}ش|ما [\u0621-\u064a]{2,}ش')],
];
const NOT_COLLOQUIAL = new Set(['واتساب', 'الواتساب', 'بالواتساب', 'للواتساب', 'وواتساب', 'بنتيجة', 'بنتائج', 'بنتيجته']);
/** Strings that hold a colloquial word because they are data, not words shown to a person: matched or stored as they are. */
export const ALLOWED = new Map([
]);

export function colloquialHits(text) {
  const hits = [];
  for (const [kind, pattern] of COLLOQUIAL) {
    const global = new RegExp(pattern.source, 'gu');
    for (const match of text.matchAll(global)) if (!NOT_COLLOQUIAL.has(match[0])) hits.push(kind + ': ' + match[0]);
  }
  return hits;
}

function* sources(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') yield* sources(relative); continue; }
    if (/\.(tsx?|mts|mjs|cjs|js)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) yield relative;
  }
}

const found = [];
let literals = 0, files = 0;
const consider = (file, text, line) => {
  literals++;
  const hits = colloquialHits(text);
  if (!hits.length) return;
  if (ALLOWED.has(text)) return;
  found.push(file + ':' + line + '  [' + hits.join(', ') + ']  ' + text.slice(0, 220));
};
for (const dir of ['app', 'lib', 'portable', 'components']) {
  for (const file of sources(dir)) {
    files++;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const {text, line} of stringLiterals(source)) consider(file, text, line);
    const unread = unreadArabicLines(source);
    if (unread.length) found.push(file + ': lines with Arabic the scanner could not read: ' + unread.slice(0, 5).join(', '));
  }
}
// The English dictionary's Arabic keys are the Arabic the screens show; the release notes of the app update are shown on the phone.
for (const [key] of Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'lib/locales/en.json'), 'utf8')))) consider('lib/locales/en.json', key, 0);
const release = JSON.parse(fs.readFileSync(path.join(root, 'lib/app-update-release.json'), 'utf8'));
JSON.stringify(release, (key, value) => { if (typeof value === 'string') consider('lib/app-update-release.json', value, 0); return value; });

// The scanner itself: it finds what it should and leaves the written language alone.
ok(colloquialHits('اللينك ده مش شغال').length >= 3, 'the scanner finds the colloquial words');
ok(colloquialHits('الطلب هيتبعت للإنتاج').length === 1, 'the future with ه');
ok(colloquialHits('العميل بيوقّع دلوقتي').length === 2, 'the progressive with ب');
ok(colloquialHits('الطلب اتعدّل').length === 1, 'the passive with ات');
ok(colloquialHits('ما اتحفظتش').length >= 1 && colloquialHits('عملاؤك ما اشتروش').length === 1, 'the negation');
ok(colloquialHits('تعذّر حفظ البيانات؛ أعد المحاولة. يتم إرسال الطلب بعد توقيع العميل، ولا يمكن حذف التوقيع.').length === 0, 'written Arabic passes');
ok(colloquialHits('بيانات الاتصال والاتجاه بتاريخ اليوم؛ تتبع الزيارة وتتغير الحالة ويتأكد المدير').length === 0, 'written words that look like the colloquial forms pass');
ok(stringLiterals("const a='نص';// تعليق مش هنا\nconst b=`قبل ${x?'داخل':''} بعد`;/* مش */const c=<p>نص JSX</p>;").map(item => item.text).join('|') === 'نص|قبل |داخل|{} بعد|نص JSX', 'the literals, the template pieces and JSX text are read; comments are not');

if (process.env.MSA_REPORT) { console.log(found.join('\n')); console.log(found.length + ' strings'); }
ok(files > 100 && literals > 4000, 'the sources were read (' + files + ' files, ' + literals + ' strings)');
assert.deepEqual(found, [], 'colloquial words in the application\'s Arabic:\n' + found.join('\n'));
checks++;
for (const text of ALLOWED.keys()) ok(found.every(item => !item.endsWith(text)) && colloquialHits(text).length > 0, 'an allowed string still needs its place: ' + text);
console.log(`msa wording checks passed: ${checks} (${files} files, ${literals} Arabic strings)`);
