function json(data, init = {}) {
  const body = JSON.stringify(data);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(body, { ...init, headers });
}

export async function onRequest({ request }) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });
  return json({ ok: true, time: new Date().toISOString() }, { status: 200 });
}

