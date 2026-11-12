/** Origin-restricted proxy. Apps Script validates sessions and roles on every call. */
const allowedMethods = new Set(['POST','OPTIONS']);
const maxBytes = 1500000;
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = (env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
    const headers = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    };
    const response = (data, status) => new Response(JSON.stringify(data), {status, headers:{...headers,'Content-Type':'application/json;charset=utf-8'}});
    if (!allowedOrigin || !origin || origin !== allowedOrigin) return new Response('Origin not allowed', {status:403, headers:{'Cache-Control':'no-store'}});
    if (!allowedMethods.has(request.method)) return response({ok:false,error:'Method not allowed'},405);
    if (request.method === 'OPTIONS') return new Response(null, {status:204,headers});
    if (!env.APPS_SCRIPT_URL || !/^https:\/\/script\.google\.com\/macros\/s\//.test(env.APPS_SCRIPT_URL)) return response({ok:false,error:'Server is not configured'},503);
    if (Number(request.headers.get('Content-Length')||0) > maxBytes) return response({ok:false,error:'Request too large'},413);
    if (!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')) return response({ok:false,error:'Expected JSON'},415);
    const body = await request.text();
    if (body.length > maxBytes) return response({ok:false,error:'Request too large'},413);
    let parsed;
    try { parsed=JSON.parse(body); } catch (_) { return response({ok:false,error:'Invalid JSON'},400); }
    if (!parsed || typeof parsed.method!=='string' || !Array.isArray(parsed.args)) return response({ok:false,error:'Invalid request'},400);
    try {
      const upstream=await fetch(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body,redirect:'follow'});
      const text=await upstream.text();
      if (!upstream.ok) return response({ok:false,error:'Backend unavailable'},502);
      const result=JSON.parse(text);
      return response(result,200);
    } catch (_) {
      return response({ok:false,error:'Unable to contact the server'},502);
    }
  }
};
