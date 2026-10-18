// The tracking board customer service follows on the Opportunities page, as pure functions: the stage bar of an opportunity and of a
// complaint and of an assistance request (the supervisor's step only when it applies, a returned item marked, a finished one complete, a cancelled one without a bar),
// the side each stage waits on, who holds it, the late flag and the last thing recorded, what each member follows (a representative what
// they registered, a manager what the team registered), the thirty-day window for finished items, the order, the filters and their counts.
// The stages the real queue and complaint functions can produce are all covered by the board. No browser, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd(), runtime = path.join(root, '.sites-runtime');
fs.mkdirSync(runtime, {recursive: true});
const out = fs.mkdtempSync(path.join(runtime, 'service-tracking-')), seen = new Set();
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));
function compile(relative) {
  if (seen.has(relative)) return; seen.add(relative);
  const src = path.join(root, relative), dest = path.join(out, relative.replace(/\.tsx?$/, '.mjs')); fs.mkdirSync(path.dirname(dest), {recursive: true});
  let code = ts.transpileModule(fs.readFileSync(src, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (match, quote, imported) => {
    if (!imported.startsWith('.') && !imported.startsWith('@/')) return match;
    let child = imported.startsWith('@/') ? imported.slice(2) : path.relative(root, path.resolve(path.dirname(src), imported));
    if (!/\.tsx?$/.test(child)) child += fs.existsSync(path.join(root, child + '.ts')) ? '.ts' : '.tsx';
    compile(child); return 'from ' + JSON.stringify(path.join(out, child.replace(/\.tsx?$/, '.mjs')));
  });
  fs.writeFileSync(dest, code);
}
for (const file of ['lib/service-tracking.ts', 'lib/service-queue.ts', 'lib/complaints.ts', 'lib/support.ts']) compile(file);
const T = await import(path.join(out, 'lib/service-tracking.mjs')), Q = await import(path.join(out, 'lib/service-queue.mjs')), C = await import(path.join(out, 'lib/complaints.mjs')), S = await import(path.join(out, 'lib/support.mjs'));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ids = steps => steps.map(step => step.id), states = steps => steps.map(step => step.state);
const NOW = '2026-10-17T09:00:00.000Z', daysAgo = days => new Date(Date.parse(NOW) - days * 86400000).toISOString();

// ---- the bar of an opportunity
const OPP = ['registered', 'approval', 'assignment', 'first_contact', 'follow_up', 'finished'];
eq(ids(T.trackingSteps('opportunity', 'approval', false)), OPP, 'an opportunity passes registration, approval, assignment, first contact, follow-up and its end; no supervisor step unless it applies');
eq(states(T.trackingSteps('opportunity', 'approval', false)), ['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'], 'at approval: registered is done, approval is the current step');
eq(T.trackingSteps('opportunity', 'returned', false).map(step => [step.id, step.state, step.returned]).filter(([, state]) => state === 'current'), [['approval', 'current', true]], 'returned for correction: still the approval step, marked as returned');
eq(states(T.trackingSteps('opportunity', 'assignment', false)), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'], 'at assignment');
eq([ids(T.trackingSteps('opportunity', 'delegation', false)), states(T.trackingSteps('opportunity', 'delegation', false))], [['registered', 'approval', 'assignment', 'delegation', 'first_contact', 'follow_up', 'finished'], ['done', 'done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']], 'with a supervisor, the delegation step appears and is current');
eq(states(T.trackingSteps('opportunity', 'first_contact', true)), ['done', 'done', 'done', 'done', 'current', 'upcoming', 'upcoming'], 'after a delegation the step stays, done');
eq(states(T.trackingSteps('opportunity', 'first_contact', false)), ['done', 'done', 'done', 'current', 'upcoming', 'upcoming'], 'without one it never appears');
eq(states(T.trackingSteps('opportunity', 'follow_up', false)), ['done', 'done', 'done', 'done', 'current', 'upcoming'], 'at follow-up');
eq(states(T.trackingSteps('opportunity', 'closed', false)), ['done', 'done', 'done', 'done', 'done', 'done'], 'a finished opportunity has every step done');
eq(states(T.trackingSteps('opportunity', 'something-new', false)), ['done', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'], 'an unknown stage still shows the registration as done and marks nothing current');
eq(T.trackingSteps('opportunity', 'approval', false).every(step => step.returned === false), true, 'nothing is marked returned unless it is');

// ---- the bar of a complaint
const CMP = ['registered', 'review', 'assignment', 'first_contact', 'resolution', 'closure'];
eq(ids(T.trackingSteps('complaint', 'review', false)), CMP, 'a complaint passes registration, review, assignment, first contact, resolution and closure');
eq(states(T.trackingSteps('complaint', 'review', false)), ['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'], 'at review');
eq(T.trackingSteps('complaint', 'fix', false).filter(step => step.state === 'current').map(step => [step.id, step.returned]), [['review', true]], 'returned for correction is the review step, marked');
eq(states(T.trackingSteps('complaint', 'assignment', false)), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'], 'at assignment');
eq(ids(T.trackingSteps('complaint', 'delegation', false)), ['registered', 'review', 'assignment', 'delegation', 'first_contact', 'resolution', 'closure'], 'with a supervisor the delegation step appears');
eq(states(T.trackingSteps('complaint', 'resolution', true)), ['done', 'done', 'done', 'done', 'done', 'current', 'upcoming'], 'at resolution after a delegation');
eq(states(T.trackingSteps('complaint', 'closure', false)), ['done', 'done', 'done', 'done', 'done', 'current'], 'waiting for the closure');
eq(states(T.trackingSteps('complaint', 'closed', false)), ['done', 'done', 'done', 'done', 'done', 'done'], 'a closed complaint is complete');
eq(T.trackingSteps('complaint', 'cancelled', false), [], 'a cancelled complaint has no bar');

// ---- the bar of an assistance request or a missed visit
const SUP = ['registered', 'contact', 'review', 'assignment', 'first_contact', 'closure'];
eq(ids(T.trackingSteps('support', 'contact', false)), SUP, 'a request passes the opening, customer service\'s contact, the manager\'s review, the sales assignment, the sales contact and the closure');
eq(states(T.trackingSteps('support', 'contact', false)), ['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'], 'in the customer-service member\'s contact');
eq(states(T.trackingSteps('support', 'take', false)), ['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'], 'waiting to be taken is the same step, not yet begun by anyone');
eq(states(T.trackingSteps('support', 'review', false)), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'], 'at the manager\'s review');
eq(T.trackingSteps('support', 'fix', false).filter(step => step.state === 'current').map(step => [step.id, step.returned]), [['review', true]], 'returned for correction is the review step, marked');
eq(states(T.trackingSteps('support', 'assignment', false)), ['done', 'done', 'done', 'current', 'upcoming', 'upcoming'], 'at the sales assignment');
eq([ids(T.trackingSteps('support', 'delegation', false)), states(T.trackingSteps('support', 'delegation', false))], [['registered', 'contact', 'review', 'assignment', 'delegation', 'first_contact', 'closure'], ['done', 'done', 'done', 'done', 'current', 'upcoming', 'upcoming']], 'with a supervisor the delegation step appears');
eq(states(T.trackingSteps('support', 'first_contact', true)), ['done', 'done', 'done', 'done', 'done', 'current', 'upcoming'], 'at the sales contact after a delegation');
eq(states(T.trackingSteps('support', 'closure', false)), ['done', 'done', 'done', 'done', 'done', 'current'], 'waiting for customer service to close it');
eq(states(T.trackingSteps('support', 'closed', false)), ['done', 'done', 'done', 'done', 'done', 'done'], 'a closed request is complete');
eq(T.trackingSteps('support', 'cancelled', false), [], 'a cancelled request has no bar');
eq(['take', 'contact'].map(T.trackingSide), ['service', 'service'], 'waiting to be taken and the contact wait on customer service');

// ---- the side each stage waits on
eq(['approval', 'returned', 'review', 'fix', 'closure'].map(T.trackingSide), Array(5).fill('service'), 'approval, review, correction and closure wait on customer service');
eq(['assignment', 'delegation', 'first_contact', 'follow_up', 'resolution'].map(T.trackingSide), Array(5).fill('sales'), 'assignment, delegation, contacts and resolution wait on sales');
eq(['closed', 'cancelled'].map(T.trackingSide), ['done', 'done'], 'closed and cancelled are finished');

// ---- every stage the real functions can produce is on the board
const queueStages = new Set(), complaintStages = new Set();
for (const status of ['pending_approval', 'returned', 'pending_assignment', 'assigned', 'other'])
  for (const state of ['won', 'lost', status])
    for (const contacts of [0, 1])
      for (const role of ['supervisor', 'rep', ''])
        queueStages.add(Q.queueStage({status, updatedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', data: {assignedAt: '2026-10-02T00:00:00Z'}}, state, contacts, role).stage);
for (const status of ['submitted', 'returned', 'pending_assignment', 'assigned', 'resolved', 'closed', 'cancelled'])
  for (const role of ['supervisor', 'rep', ''])
    for (const updates of [[], [{at: '2026-10-05T00:00:00Z'}]])
      complaintStages.add(C.complaintStage({status, updates, submittedAt: '2026-10-01T00:00:00Z', assignedAt: '2026-10-02T00:00:00Z'}, role).stage);
const supportStages = new Set();
for (const status of ['open', 'submitted', 'returned', 'pending_assignment', 'assigned', 'resolved', 'done', 'cancelled'])
  for (const role of ['supervisor', 'rep', ''])
    for (const handlerId of ['', 'cs'])
      supportStages.add(S.supportStage({data: {status, handlerId, submittedAt: '2026-10-01T00:00:00Z', assignedAt: '2026-10-02T00:00:00Z'}, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z'}, role).stage);
eq([...supportStages].sort(), ['assignment', 'cancelled', 'closed', 'closure', 'contact', 'delegation', 'first_contact', 'fix', 'review', 'take'], 'the support functions produce exactly these stages');
eq([...queueStages].sort(), ['approval', 'assignment', 'closed', 'delegation', 'first_contact', 'follow_up', 'returned'], 'the queue produces exactly these stages');
eq([...complaintStages].sort(), ['assignment', 'cancelled', 'closed', 'closure', 'delegation', 'first_contact', 'fix', 'resolution', 'review'], 'the complaint functions produce exactly these stages');
for (const [kind, stages] of [['opportunity', queueStages], ['complaint', complaintStages], ['support', supportStages]])
  for (const stage of stages) {
    eq(Object.keys(T.trackingStageText).includes(stage) || (kind === 'support' && Object.keys(T.trackingSupportStageText).includes(stage)), true, kind + ' stage ' + stage + ' has its words');
    const steps = T.trackingSteps(kind, stage, false);
    eq(stage === 'cancelled' ? steps.length === 0 : steps.filter(step => step.state === 'current').length === (stage === 'closed' ? 0 : 1), true, kind + ' stage ' + stage + ' marks exactly one current step, or none when finished');
    eq(['service', 'sales', 'done'].includes(T.trackingSide(stage)), true, kind + ' stage ' + stage + ' has a side');
  }
eq(Object.keys(T.trackingStepLabels).sort(), [...new Set([...OPP, ...CMP, ...SUP, 'delegation'])].sort(), 'every step has its label, Arabic and English');
eq(Object.values({...T.trackingStepLabels, ...T.trackingHolderLabels, ...T.trackingStageText, ...T.trackingSupportStageText, ...T.trackingFilterLabels, ...T.trackingOpportunityOutcomes}).every(pair => pair.length === 2 && pair.every(word => typeof word === 'string' && word.length > 0)), true, 'every label has both languages');
eq(/[؀-ۿ]/.test(Object.values({...T.trackingStepLabels, ...T.trackingHolderLabels, ...T.trackingStageText, ...T.trackingSupportStageText, ...T.trackingFilterLabels}).map(pair => pair[1]).join(' ')), false, 'and the English has no Arabic letter');

// ---- fixtures
const progress = (o = {}) => ({stage: 'approval', since: daysAgo(0.5), stageHours: 3, targetHours: 4, late: false, assigneeRole: '', finishedAt: '', ...o});
const opportunity = (o = {}) => ({
  id: 'service-1', state: 'pending_approval', creatorId: 'rep-1', creatorName: 'ريم', serviceManagerName: 'منى', salesManagerName: 'خالد', assignedName: '', createdAt: daysAgo(1), updatedAt: daysAgo(1),
  data: {products: ['قوالب'], needs: 'قالب علب 500 جم', delegatedAt: ''}, customer: {id: 'c-1', name: 'مصنع الأمل'}, progress: progress(), contacts: [], history: [], ...o
});
const complaint = (o = {}) => ({
  id: 'complaint-1', customerId: 'c-2', customerName: 'مصنع النور', complaintNumber: 7, category: 'product_quality', severity: 'normal', description: 'بلوك مكسور', status: 'submitted', stage: 'review',
  stageSince: daysAgo(0.4), stageHours: 3, targetHours: 4, late: false, createdAt: daysAgo(1), updatedAt: daysAgo(1), registrarId: 'rep-1', registrarName: 'ريم', serviceManagerName: 'منى', salesManagerName: 'خالد',
  assigneeName: '', assigneeRole: '', events: [], updates: [], notes: [], closure: null, ...o
});

// ---- an opportunity as a board row
const waiting = T.trackedOpportunity(opportunity());
eq([waiting.key, waiting.kind, waiting.customerName, waiting.products, waiting.needs, waiting.side, waiting.stage], ['opportunity:service-1', 'opportunity', 'مصنع الأمل', ['قوالب'], 'قالب علب 500 جم', 'service', 'approval'], 'the row names the customer, the products and where it waits');
eq([waiting.holder, waiting.late, waiting.stageHours, waiting.targetHours, waiting.finishedAt, waiting.outcome], [{name: 'منى', role: 'service_manager'}, false, 3, 4, '', ''], 'the service manager holds it, within its target, unfinished');
eq(T.trackedOpportunity(opportunity({serviceManagerName: ''})).holder, {name: '', role: 'admin'}, 'with no manager an administrator holds the approval');
eq(T.trackedOpportunity(opportunity({progress: progress({stage: 'returned'})})).holder, {name: 'ريم', role: 'registrar'}, 'returned for correction: the registrar holds it');
eq(T.trackedOpportunity(opportunity({progress: progress({stage: 'assignment', late: true, stageHours: 6})})).holder, {name: 'خالد', role: 'sales_manager'}, 'at assignment the sales manager holds it');
const late = T.trackedOpportunity(opportunity({progress: progress({stage: 'assignment', late: true, stageHours: 6})}));
eq([late.late, late.stageHours, late.side], [true, 6, 'sales'], 'late at assignment, six working hours');
eq(T.trackedOpportunity(opportunity({assignedName: 'سالم', progress: progress({stage: 'delegation', assigneeRole: 'supervisor'})})).holder, {name: 'سالم', role: 'supervisor'}, 'a supervisor holds it for delegation');
eq([['rep'], ['supervisor'], ['']].map(([role]) => T.trackedOpportunity(opportunity({assignedName: 'سالم', progress: progress({stage: 'first_contact', assigneeRole: role})})).holder.role), ['rep', 'supervisor', 'sales'], 'the first contact is held by a representative, a supervisor, or a sales owner of unknown role');
eq(T.trackedOpportunity(opportunity({assignedName: 'سالم', data: {delegatedAt: daysAgo(1)}, progress: progress({stage: 'follow_up', assigneeRole: 'rep'})})).delegated, true, 'a delegation date marks the delegation step');
const won = T.trackedOpportunity(opportunity({state: 'won', progress: progress({stage: 'closed', finishedAt: daysAgo(2), late: true})}));
eq([won.side, won.outcome, won.finishedAt, won.holder, won.late, won.steps.every(step => step.state === 'done')], ['done', 'won', daysAgo(2), null, false, true], 'a won opportunity is finished, has no holder and is never late');
eq(T.trackedOpportunity(opportunity({state: 'lost', progress: progress({stage: 'closed'}), updatedAt: daysAgo(3)})).finishedAt, daysAgo(3), 'without a finish date the update time stands in');
const bare = T.trackedOpportunity(opportunity({progress: undefined}));
eq([bare.stage, bare.stageHours, bare.late, bare.stageSince], ['approval', 0, false, bare.registeredAt], 'a case without its progress is placed at approval and never late');
eq(T.trackedOpportunity(opportunity({data: {}})).products, [], 'no products is an empty list');
// the last thing recorded: the newest of a contact and an internal note
const withLast = T.trackedOpportunity(opportunity({
  contacts: [{createdAt: daysAgo(3), result: 'تم الاتصال', summary: 'x', actor: 'سالم'}, {createdAt: daysAgo(2), result: '', summary: 'زيارة أولى', actor: 'سالم'}],
  history: [{createdAt: daysAgo(1), actor: 'منى', action: 'service:note', detail: {note: 'يلزم عرض سعر'}}, {createdAt: daysAgo(0.5), actor: 'منى', action: 'service:approve', detail: {note: 'اعتماد'}}, {createdAt: daysAgo(0.2), actor: 'منى', action: 'service:note', detail: {note: ''}}]
}));
eq(withLast.last, {kind: 'note', at: daysAgo(1), by: 'منى', text: 'يلزم عرض سعر'}, 'the newest note counts, a movement of the case or an empty note does not');
eq(T.trackedOpportunity(opportunity({contacts: [{createdAt: daysAgo(3), result: 'تم الاتصال', actor: 'سالم'}, {createdAt: daysAgo(2), summary: 'زيارة أولى', actor: 'سالم'}]})).last, {kind: 'contact', at: daysAgo(2), by: 'سالم', text: 'زيارة أولى'}, 'a contact reads its result, or its summary when there is no result');
eq(T.trackedOpportunity(opportunity()).last, null, 'nothing recorded is null');

// ---- a complaint as a board row
const review = T.trackedComplaint(complaint());
eq([review.key, review.kind, review.complaintNumber, review.category, review.severity, review.side, review.holder, review.late], ['complaint:complaint-1', 'complaint', 7, 'product_quality', 'normal', 'service', {name: 'منى', role: 'service_manager'}, false], 'a complaint waits for the manager\'s review');
eq(T.trackedComplaint(complaint({serviceManagerName: ''})).holder, {name: '', role: 'admin'}, 'unrouted: an administrator reviews');
eq([['fix', 'registrar'], ['closure', 'registrar'], ['assignment', 'sales_manager']].map(([stage, role]) => [T.trackedComplaint(complaint({stage})).holder.role === role, T.trackedComplaint(complaint({stage})).holder.name]), [[true, 'ريم'], [true, 'ريم'], [true, 'خالد']], 'correction and closure are the registrar\'s, assignment the sales manager\'s');
eq([['delegation', 'supervisor', 'supervisor'], ['first_contact', 'rep', 'rep'], ['resolution', 'rep', 'rep'], ['resolution', 'supervisor', 'supervisor'], ['first_contact', '', 'sales']].map(([stage, assigneeRole, expected]) => T.trackedComplaint(complaint({stage, assigneeName: 'سالم', assigneeRole})).holder.role === expected), Array(5).fill(true), 'the holder of a sales stage follows the role of the assignee');
eq(T.trackedComplaint(complaint({stage: 'resolution', assigneeName: 'سالم', assigneeRole: 'rep', events: [{action: 'register'}, {action: 'delegate'}]})).delegated, true, 'a delegate event marks the delegation step');
eq(T.trackedComplaint(complaint({stage: 'resolution', assigneeName: 'سالم', assigneeRole: 'rep', events: [{action: 'register'}, {action: 'assign'}]})).delegated, false, 'an assignment alone does not');
eq(T.trackedComplaint(complaint({late: true, stage: 'review'})).late, true, 'a late review is late');
const closed = T.trackedComplaint(complaint({status: 'closed', stage: 'closed', late: true, stageSince: daysAgo(4), closure: {outcome: 'satisfied'}}));
eq([closed.side, closed.outcome, closed.finishedAt, closed.holder, closed.late, closed.steps.every(step => step.state === 'done')], ['done', 'satisfied', daysAgo(4), null, false, true], 'a closed complaint: finished, its closure outcome, no holder, not late');
const cancelled = T.trackedComplaint(complaint({status: 'cancelled', stage: 'cancelled', stageSince: daysAgo(5)}));
eq([cancelled.side, cancelled.outcome, cancelled.steps, cancelled.finishedAt], ['done', 'cancelled', [], daysAgo(5)], 'a cancelled complaint: finished, cancelled, no bar');
eq(T.trackedComplaint(complaint({severity: 'high', complaintNumber: null})).severity, 'high', 'importance rides along');
eq(T.trackedComplaint(complaint({complaintNumber: null})).complaintNumber, null, 'a complaint registered before numbering has none');
eq(T.trackedComplaint(complaint({
  updates: [{at: daysAgo(3), byName: 'سالم', text: 'اتصلت بالعميل'}, {at: daysAgo(1), byName: 'سالم', text: 'زرت المصنع'}],
  notes: [{at: daysAgo(2), byName: 'منى', text: 'ملاحظة قديمة'}]
})).last, {kind: 'update', at: daysAgo(1), by: 'سالم', text: 'زرت المصنع'}, 'the newest update or note is the last thing recorded');
eq(T.trackedComplaint(complaint({updates: [{at: daysAgo(3), byName: 'سالم', text: 'اتصلت'}], notes: [{at: daysAgo(1), byName: 'منى', text: 'يلزم تصعيد'}]})).last.kind, 'note', 'a newer note wins over an older update');

// ---- an assistance request as a board row
const supportEntry = (o = {}) => ({
  id: 'support-1', customerId: 'c-3', customerName: 'مصنع الريان', origin: 'rep', state: 'in_progress', status: 'open', note: 'العميل لا يرد على المندوب', plan: null, requestedByName: 'محمد',
  handlerId: 'rep-1', handlerName: 'ريم', serviceManagerName: 'منى', salesManagerName: 'خالد', assigneeName: '', assigneeRole: '', result: null, resolution: null,
  stage: 'contact', stageSince: daysAgo(0.3), stageHours: 2, targetHours: 4, late: false, createdAt: daysAgo(1), updatedAt: daysAgo(1), events: [], ...o
});
const event = (action, at, byName, extra = {}) => ({at, by: byName, byName, action, targetName: '', ...extra});
const contact = T.trackedSupport(supportEntry());
eq([contact.key, contact.kind, contact.origin, contact.customerName, contact.needs, contact.side, contact.stage, contact.registrarId, contact.registrarName, contact.holder, contact.late], ['support:support-1', 'support', 'rep', 'مصنع الريان', 'العميل لا يرد على المندوب', 'service', 'contact', 'rep-1', 'ريم', {name: 'ريم', role: 'registrar'}, false], 'the row names the customer and the reason; the member who took it holds it');
eq([contact.products, contact.category, contact.complaintNumber, contact.severity, contact.trail, contact.last], [[], '', null, 'normal', [], null], 'it has no products, category or number, and nothing recorded yet');
const untaken = T.trackedSupport(supportEntry({state: 'waiting', stage: 'take', handlerId: '', handlerName: ''}));
eq([untaken.holder, untaken.registrarName, untaken.registrarId, untaken.side], [{name: '', role: 'registrar'}, 'محمد', '', 'service'], 'a request nobody took is held by customer service, named after who asked');
const missedRow = T.trackedSupport(supportEntry({origin: 'missed_visit', note: '', plan: {visitId: 'v', visitDate: '2026-10-05', result: 'سلبية', nextAction: 'زيارة متابعة', nextDate: '2026-10-10'}}));
eq([missedRow.origin, missedRow.needs], ['missed_visit', 'زيارة متابعة · 2026-10-10'], 'a missed visit reads its planned visit where there is no reason');
eq([['review', 'منى', 'service_manager'], ['fix', 'ريم', 'registrar'], ['closure', 'ريم', 'registrar'], ['assignment', 'خالد', 'sales_manager']].map(([stage, name, role]) => {const holder = T.trackedSupport(supportEntry({stage})).holder; return [holder.name === name, holder.role === role];}), Array(4).fill([true, true]), 'the manager reviews, the member who took it corrects and closes, the sales manager assigns');
eq(T.trackedSupport(supportEntry({stage: 'review', serviceManagerName: ''})).holder, {name: '', role: 'admin'}, 'with nobody managing the member, an administrator reviews');
eq([['delegation', 'supervisor', 'supervisor'], ['first_contact', 'rep', 'rep'], ['first_contact', 'supervisor', 'supervisor'], ['first_contact', '', 'sales']].map(([stage, assigneeRole, expected]) => T.trackedSupport(supportEntry({stage, assigneeName: 'سالم', assigneeRole})).holder.role === expected), [true, true, true, true], 'the supervisor delegates; the sales member contacts the customer');
eq([T.trackedSupport(supportEntry({stage: 'first_contact', assigneeName: 'سالم', assigneeRole: 'rep', events: [event('request', daysAgo(2), 'محمد'), event('delegate', daysAgo(1), 'عمر')]})).delegated, T.trackedSupport(supportEntry({stage: 'first_contact', assigneeName: 'سالم', assigneeRole: 'rep', events: [event('allocate', daysAgo(1), 'خالد')]})).delegated], [true, false], 'a delegate event marks the delegation step, an assignment alone does not');
eq([['review', 3.5, 4, true]].map(([stage, hours, target, late]) => { const row = T.trackedSupport(supportEntry({stage, stageHours: hours, targetHours: target, late})); return [row.late, row.stageHours, row.targetHours]; }), [[true, 3.5, 4]], 'lateness, hours and target come with the stage');
const trailed = T.trackedSupport(supportEntry({stage: 'closure', events: [
  event('request', daysAgo(5), 'محمد', {text: 'العميل لا يرد'}), event('assign', daysAgo(5), '', {targetName: 'ريم'}), event('submit', daysAgo(4), 'ريم', {outcome: 'reached_interested', text: 'العميل مهتم'}),
  event('forward', daysAgo(3), 'منى', {targetName: 'خالد'}), event('allocate', daysAgo(2), 'خالد', {targetName: 'سالم', text: 'الزيارة هذا الأسبوع'}), event('resolve', daysAgo(1), 'سالم', {outcome: 'reached_interested', text: 'زرته واتفقنا'}), event('seen', daysAgo(0.5), 'محمد')
]}));
eq(trailed.trail.map(step => [step.action, step.by, step.outcome, step.text, step.target]), [['request', 'محمد', '', 'العميل لا يرد', ''], ['assign', '', '', '', 'ريم'], ['submit', 'ريم', 'reached_interested', 'العميل مهتم', ''], ['forward', 'منى', '', '', 'خالد'], ['allocate', 'خالد', '', 'الزيارة هذا الأسبوع', 'سالم'], ['resolve', 'سالم', 'reached_interested', 'زرته واتفقنا', '']], 'the trail tells each step with who did it, what they chose or wrote and whom they handed it to; opening the answer is left out');
eq(trailed.last, {kind: 'contact', at: daysAgo(1), by: 'سالم', text: 'زرته واتفقنا'}, 'the last thing recorded is the newest step that carries a result or a text');
const finishedSupport = T.trackedSupport(supportEntry({state: 'done', status: 'done', stage: 'closed', stageSince: daysAgo(4), late: true, result: {outcome: 'wants_visit'}, resolution: {outcome: 'reached_interested'}}));
eq([finishedSupport.side, finishedSupport.outcome, finishedSupport.finishedAt, finishedSupport.holder, finishedSupport.late, finishedSupport.steps.every(step => step.state === 'done')], ['done', 'reached_interested', daysAgo(4), null, false, true], 'a closed request: finished, the outcome the sales member recorded, nobody holds it, never late');
eq(T.trackedSupport(supportEntry({state: 'done', status: 'done', stage: 'closed', stageSince: daysAgo(4), result: {outcome: 'no_answer'}, resolution: null})).outcome, 'no_answer', 'one closed before the chain existed keeps customer service\'s own outcome');
const cancelledSupport = T.trackedSupport(supportEntry({state: 'cancelled', status: 'cancelled', stage: 'cancelled', stageSince: daysAgo(5)}));
eq([cancelledSupport.side, cancelledSupport.outcome, cancelledSupport.steps, cancelledSupport.finishedAt], ['done', 'cancelled', [], daysAgo(5)], 'a cancelled request: finished, cancelled, no bar');
eq(['take', 'contact', 'review', 'assignment', 'delegation', 'first_contact', 'closure'].map(stage => T.trackingStageLabel('support', stage)[0]), ['بانتظار تولّي خدمة العملاء', 'قيد تواصل خدمة العملاء', 'بانتظار مراجعة المدير', 'بانتظار تكليف المبيعات', 'لدى المشرف بانتظار التفويض', 'بانتظار تواصل المندوب مع العميل', 'بانتظار إغلاق خدمة العملاء'], 'a request\'s stages have their own words where they differ');
eq([T.trackingStageLabel('complaint', 'closure')[0], T.trackingStageLabel('opportunity', 'first_contact')[0], T.trackingStageLabel('support', 'nonsense')], ['بانتظار تأكيد الإغلاق مع العميل', 'بانتظار أول تواصل', ['nonsense', 'nonsense']], 'a complaint and an opportunity keep theirs; an unknown stage is its own name');

// ---- what each member follows in assistance requests
const supports = [
  supportEntry({id: 's-own-late', handlerId: 'rep-1', late: true, stageHours: 6, stage: 'review', serviceManagerName: 'منى'}),
  supportEntry({id: 's-own-open', handlerId: 'rep-1', createdAt: daysAgo(2)}),
  supportEntry({id: 's-other', handlerId: 'rep-2', handlerName: 'هدى', createdAt: daysAgo(3), stage: 'first_contact', assigneeName: 'سالم', assigneeRole: 'rep', stageHours: 30}),
  supportEntry({id: 's-untaken', handlerId: '', handlerName: '', stage: 'take', state: 'waiting', createdAt: daysAgo(0.5)}),
  supportEntry({id: 's-own-done', handlerId: 'rep-1', state: 'done', status: 'done', stage: 'closed', stageSince: daysAgo(29), resolution: {outcome: 'reached_interested'}}),
  supportEntry({id: 's-own-old', handlerId: 'rep-1', state: 'done', status: 'done', stage: 'closed', stageSince: daysAgo(31), resolution: {outcome: 'reached_interested'}})
];
const mineSupport = T.trackingItems({me: {id: 'rep-1', role: 'customer_service'}, cases: [], complaints: [], support: supports, now: NOW});
eq(mineSupport.map(item => item.key), ['support:s-own-late', 'support:s-own-open', 'support:s-own-done'], 'a representative follows only what they took: the late first, then the open, then what finished within thirty days; what nobody took and a colleague\'s are not theirs');
const teamSupport = T.trackingItems({me: {id: 'csm-1', role: 'customer_service_manager'}, cases: [], complaints: [], support: supports, now: NOW});
eq(teamSupport.map(item => item.key), ['support:s-own-late', 'support:s-other', 'support:s-untaken', 'support:s-own-open', 'support:s-own-done'], 'a manager follows every request the route gives them, including what nobody has taken yet');
eq(T.trackingItems({me: {id: 'admin-1', role: 'admin'}, cases: [], complaints: [], support: supports, now: NOW}), [], 'the board is still for customer-service members');
eq(T.trackingItems({me: {id: 'rep-1', role: 'customer_service'}, cases: [], complaints: [], support: null, now: NOW}), [], 'nothing loaded is an empty board');

// ---- what each member follows
const items = {
  cases: [
    opportunity({id: 'o-own-late', creatorId: 'rep-1', progress: progress({stage: 'assignment', late: true, stageHours: 9})}),
    opportunity({id: 'o-own-open', creatorId: 'rep-1', createdAt: daysAgo(2), progress: progress({stage: 'approval', stageHours: 2})}),
    opportunity({id: 'o-other', creatorId: 'rep-2', creatorName: 'هدى', createdAt: daysAgo(3), progress: progress({stage: 'follow_up', stageHours: 40, assigneeRole: 'rep'}), assignedName: 'سالم'}),
    opportunity({id: 'o-own-done', creatorId: 'rep-1', state: 'won', progress: progress({stage: 'closed', finishedAt: daysAgo(29)})}),
    opportunity({id: 'o-own-old', creatorId: 'rep-1', state: 'lost', progress: progress({stage: 'closed', finishedAt: daysAgo(31)})})
  ],
  complaints: [
    complaint({id: 'k-own', registrarId: 'rep-1', stage: 'assignment', stageHours: 5, late: true}),
    complaint({id: 'k-other', registrarId: 'rep-2', registrarName: 'هدى', stage: 'resolution', stageHours: 20, assigneeName: 'سالم', assigneeRole: 'rep'}),
    complaint({id: 'k-closed', registrarId: 'rep-1', status: 'closed', stage: 'closed', stageSince: daysAgo(10), closure: {outcome: 'satisfied'}}),
    complaint({id: 'k-cancelled', registrarId: 'rep-1', status: 'cancelled', stage: 'cancelled', stageSince: daysAgo(40)})
  ]
};
const mine = T.trackingItems({me: {id: 'rep-1', role: 'customer_service'}, ...items, now: NOW});
eq(mine.map(item => item.key), ['opportunity:o-own-late', 'complaint:k-own', 'opportunity:o-own-open', 'complaint:k-closed', 'opportunity:o-own-done'], 'a representative follows only what they registered: the late first, then the open, then what finished within thirty days, the latest first (the 31-day and 40-day ones are gone)');
const team = T.trackingItems({me: {id: 'csm-1', role: 'customer_service_manager'}, ...items, now: NOW});
eq(team.map(item => item.key), ['opportunity:o-own-late', 'complaint:k-own', 'opportunity:o-other', 'complaint:k-other', 'opportunity:o-own-open', 'complaint:k-closed', 'opportunity:o-own-done'], 'a manager follows everything the routes give them, the team\'s and their own, in the same order');
const mixed = T.trackingItems({me: {id: 'csm-1', role: 'customer_service_manager'}, ...items, support: supports, now: NOW});
eq([mixed.filter(item => item.kind === 'support').length, mixed.length, T.trackingCounts(mixed)], [5, 12, {all: 12, late: 3, service: 4, sales: 5, finished: 3}], 'opportunities, complaints and assistance requests share one board, one order and one set of counts');
eq(T.trackingItems({me: {id: 'admin-1', role: 'admin'}, ...items, now: NOW}), [], 'the board is for customer-service members');
eq(T.trackingItems({me: {id: 'rep-1', role: 'rep'}, ...items, now: NOW}), [], 'and not for sales members');
eq(T.trackingItems({me: {id: 'rep-1', role: 'customer_service'}, cases: null, complaints: undefined, now: NOW}), [], 'nothing loaded is an empty board');
eq(T.trackingItems({me: {id: 'rep-1', role: 'customer_service'}, cases: [], complaints: [], now: NOW}), [], 'and so is nothing registered');
eq(T.trackingItems({me: {id: 'rep-1', role: 'customer_service'}, ...items}).length > 0, true, 'without a given time the present is used');

// ---- the order: late first, then the longest waiting in their stage, then the newest, then the key
const order = T.sortTracking([
  T.trackedOpportunity(opportunity({id: 'a', createdAt: daysAgo(5), progress: progress({stage: 'follow_up', stageHours: 30})})),
  T.trackedOpportunity(opportunity({id: 'b', createdAt: daysAgo(4), progress: progress({stage: 'follow_up', stageHours: 30})})),
  T.trackedOpportunity(opportunity({id: 'c', createdAt: daysAgo(3), progress: progress({stage: 'first_contact', stageHours: 10, late: true})})),
  T.trackedOpportunity(opportunity({id: 'd', createdAt: daysAgo(2), progress: progress({stage: 'first_contact', stageHours: 26, late: true})})),
  T.trackedOpportunity(opportunity({id: 'e', createdAt: daysAgo(4), progress: progress({stage: 'follow_up', stageHours: 30})})),
  T.trackedOpportunity(opportunity({id: 'f', state: 'won', progress: progress({stage: 'closed', finishedAt: daysAgo(9)})})),
  T.trackedOpportunity(opportunity({id: 'g', state: 'lost', progress: progress({stage: 'closed', finishedAt: daysAgo(2)})}))
]).map(item => item.id);
eq(order, ['d', 'c', 'b', 'e', 'a', 'g', 'f'], 'late first (the longer wait first), then the open by wait then newest then key, then the finished, the latest first');

// ---- the filters and their counts
const board = team;
eq(T.filterTracking(board, 'all').length, 7, 'all is everything on the board');
eq(T.filterTracking(board, 'late').map(item => item.key), ['opportunity:o-own-late', 'complaint:k-own'], 'late: the open ones past their target');
eq(T.filterTracking(board, 'service').map(item => item.key), ['opportunity:o-own-open'], 'with customer service: waiting on its approval, review, correction or closure');
eq(T.filterTracking(board, 'sales').map(item => item.key), ['opportunity:o-own-late', 'complaint:k-own', 'opportunity:o-other', 'complaint:k-other'], 'with sales: assignment, delegation, contacts, resolution');
eq(T.filterTracking(board, 'finished').map(item => item.key), ['complaint:k-closed', 'opportunity:o-own-done'], 'finished within thirty days');
eq(T.trackingCounts(board), {all: 7, late: 2, service: 1, sales: 4, finished: 2}, 'the count beside each filter');
eq(T.trackingCounts([]), {all: 0, late: 0, service: 0, sales: 0, finished: 0}, 'an empty board counts zero everywhere');
eq(T.trackingFilters, ['all', 'late', 'service', 'sales', 'finished'], 'the filters in display order');
eq(T.filterTracking([{...board[0], side: 'done', late: true}], 'late'), [], 'a finished item is never counted late');
eq(T.TRACKING_FINISHED_DAYS, 30, 'the window is thirty days');
// the boundary of the window
const edge = days => T.trackingItems({me: {id: 'csm-1', role: 'customer_service_manager'}, cases: [opportunity({id: 'x', state: 'won', progress: progress({stage: 'closed', finishedAt: daysAgo(days)})})], complaints: [], now: NOW}).length;
eq([edge(29.9), edge(30), edge(30.1)], [1, 1, 0], 'a finished item stays for thirty days exactly');
eq(T.trackingItems({me: {id: 'csm-1', role: 'customer_service_manager'}, cases: [opportunity({id: 'x', state: 'won', updatedAt: 'not a date', progress: progress({stage: 'closed', finishedAt: ''})})], complaints: [], now: NOW}).length, 0, 'a finished item with no usable date is not kept');

console.log(JSON.stringify({ok: true, checks, pureFunctions: true, productionDataUsed: false}));
