// A mold request as the release before 2026-11-08 saved it, for the tests about a request's own flow (edits, cancelling, approvals,
// production's answers, its files' places): since that release every new request is kept in the CRM until its first design file of its
// own (data.designRequired, sending.held design_file; the design file's hold has its own checks). asBefore takes the save's answer:
// a request kept for its design file loses data.designRequired (as one asked for before carries none) and is sent by its requester's
// resend, whose answer stands for the save's. The resend starts the customer's signature in the background (the save sent it right
// after the request): it is let arrive, as the save's own wait let it, so the sales manager's approval does not wait for it.
// Test fixtures only.

/** db: the built app's database (app.db); send(body): the requester's POST to /api/mold-requests; saved: the save's answer. */
export async function asBefore(db, send, saved) {
  if (saved.status !== 200) return saved;
  const body = saved.json();
  if (body.send?.code !== 'design_file') return saved;
  await db.prepare("UPDATE crm_mold_requests SET data=json_remove(data,'$.designRequired') WHERE id=?").bind(body.request.id).run();
  const answer = await send({action: 'resend', id: body.request.id});
  const onTheWay = async () => (await db.prepare("SELECT COUNT(*) AS n FROM crm_mold_design_files f JOIN crm_mold_requests r ON r.id=f.request_id WHERE f.request_id=? AND f.outbox IS NOT NULL AND f.next_attempt_at IS NOT NULL AND r.accepted IS NOT NULL").bind(body.request.id).first()).n;
  for (let n = 0; n < 100 && await onTheWay(); n++) await new Promise(resolve => setTimeout(resolve, 100));
  return answer;
}
