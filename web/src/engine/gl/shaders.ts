export const TEX_W = 256
export const Z_MAX = 1 << 20

/** Pieces: fill (mode 0), bevel strip (1), shadow (2), glow (3), flash (4). */
export const PIECES_VS = /* glsl */ `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
layout(location=0) in vec2 a_pos;
layout(location=1) in uint a_piece;
layout(location=2) in vec2 a_norm;
layout(location=3) in uint a_edge;
layout(location=4) in float a_t;
uniform vec3 u_cam;        // scale, tx, ty (css px)
uniform vec2 u_view;       // css px
uniform vec2 u_board;      // board W, H (world px)
uniform vec2 u_tex;        // image uv scale (board px → uv)
uniform float u_zMax;
uniform float u_stripW;    // world px; >0 inward (bevel), <0 outward (shadow/glow)
uniform vec2 u_offset;     // world px
uniform float u_zOverride; // <0: group z; else fixed
uniform float u_zBias;     // added to group z (shadow sits just under its group)
uniform vec4 u_lift;       // pivot.xy, scale, enabled
uniform uint u_hideMask;
uniform sampler2D u_groups;
uniform usampler2D u_pieceGroup;
uniform usampler2D u_pieceFlags;
uniform usampler2D u_edgeJoined;
out vec2 v_uv; out float v_t; out float v_shade;
flat out uint v_pflags; flat out uint v_gflags; flat out float v_joined;
ivec2 tc(uint i) { return ivec2(int(i & 255u), int(i >> 8u)); }
void main() {
  uint gid = texelFetch(u_pieceGroup, tc(a_piece), 0).r;
  vec4 g = texelFetch(u_groups, tc(gid), 0);
  uint gfl = uint(g.w + 0.5);
  v_pflags = texelFetch(u_pieceFlags, tc(a_piece), 0).r;
  v_gflags = gfl;
  v_joined = a_edge == 0xFFFFu ? 0.0 : float(texelFetch(u_edgeJoined, tc(a_edge), 0).r);
  vec2 local = a_pos - a_norm * (a_t * u_stripW);
  vec2 world = local + g.xy + u_offset;
  if ((gfl & 2u) != 0u && u_lift.w > 0.5) world = u_lift.xy + (world - u_lift.xy) * u_lift.z;
  vec2 scr = world * u_cam.x + u_cam.yz;
  vec2 ndc = vec2(scr.x / u_view.x * 2.0 - 1.0, 1.0 - scr.y / u_view.y * 2.0);
  float z = u_zOverride < 0.0 ? g.z + u_zBias : u_zOverride;
  float depth = 1.0 - 2.0 * clamp(z / u_zMax, 0.0, 1.0);
  bool hidden = (gfl & u_hideMask) != 0u;
  gl_Position = hidden ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(ndc, depth, 1.0);
  v_uv = local * u_tex;
  v_t = a_t;
  v_shade = dot(a_norm, vec2(-0.70710678, -0.70710678));
}`

export const PIECES_FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec2 v_uv; in float v_t; in float v_shade;
flat in uint v_pflags; flat in uint v_gflags; flat in float v_joined;
uniform sampler2D u_image;
uniform int u_mode;
uniform vec3 u_table;
uniform vec3 u_accent;
uniform float u_bevelFade;
uniform float u_bevelStrength;
uniform float u_dimEdges;
uniform int u_zone;
uniform float u_alpha;
uniform vec2 u_texel;     // 1 / image size
uniform float u_sharpen;  // 0 when minified, ~0.3 when magnified
out vec4 o;
vec3 sampleImage(vec2 uv) {
  // Slight negative LOD bias keeps zoomed-out pieces crisp.
  vec3 c = texture(u_image, uv, -0.35).rgb;
  if (u_sharpen > 0.0) {
    vec3 n = texture(u_image, uv + vec2(u_texel.x, 0.0)).rgb + texture(u_image, uv - vec2(u_texel.x, 0.0)).rgb
           + texture(u_image, uv + vec2(0.0, u_texel.y)).rgb + texture(u_image, uv - vec2(0.0, u_texel.y)).rgb;
    c = clamp(c + (c - n * 0.25) * u_sharpen, 0.0, 1.0);
  }
  return c;
}
float dimFactor() {
  if ((v_gflags & 1u) != 0u) return 0.0;
  bool isEdge = (v_pflags & 1u) != 0u;
  int cls = int(v_pflags >> 1u) - 1;
  if (u_dimEdges > 0.5 && !isEdge) return 0.82;
  if (u_zone >= 0 && cls != u_zone) return 0.82;
  return 0.0;
}
void main() {
  if (u_mode == 2) { if (v_joined > 0.5) discard; o = vec4(0.05, 0.03, 0.07, u_alpha * (1.0 - v_t)); return; }
  if (u_mode == 3) { if (v_joined > 0.5) discard; o = vec4(u_accent, u_alpha * (1.0 - v_t * v_t)); return; }
  if (u_mode == 4) { o = vec4(1.0, 1.0, 1.0, u_alpha); return; }
  if (u_mode == 5) { o = vec4(mix(texture(u_image, v_uv).rgb, vec3(1.0), 0.18), u_alpha); return; }
  vec3 base = sampleImage(v_uv);
  vec3 c = base;
  if (u_mode == 1) {
    if (v_joined > 0.5) discard;
    float k = 1.0 - v_t; k *= k;
    float light = v_shade * 0.46 * u_bevelStrength * k;
    c = c * (1.0 + light) + max(light, 0.0) * 0.18;
    float line = 1.0 - smoothstep(0.0, 0.22, v_t);
    c = mix(c, c * 0.38, line * 0.8);
    c = mix(base, c, u_bevelFade);
  }
  c = mix(c, u_table, dimFactor());
  if ((v_gflags & 4u) != 0u) c = mix(c, u_accent, 0.12);
  o = vec4(c, 1.0);
}`

/** Fullscreen table: felt grain, vignette, board slot with outline. */
export const BG_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const BG_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_view; uniform float u_dpr; uniform vec3 u_cam;
uniform vec3 u_table; uniform vec3 u_slot; uniform vec3 u_line; uniform vec3 u_glow;
uniform vec2 u_board; uniform float u_boardGlow; uniform float u_showSlot;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main() {
  vec2 px = gl_FragCoord.xy / u_dpr; px.y = u_view.y - px.y;
  vec2 wp = px - u_cam.yz;
  float n = hash(floor(wp)) * 0.55 + hash(floor(wp * 0.5)) * 0.45;
  vec3 c = u_table * (0.965 + 0.07 * n);
  vec2 q = px / u_view - 0.5;
  c *= 1.0 - 0.2 * dot(q, q);
  if (u_showSlot > 0.5) {
    vec2 bc = u_board * 0.5 * u_cam.x + u_cam.yz;
    float d = sdBox(px - bc, u_board * 0.5 * u_cam.x - 4.0) - 4.0;
    float inside = 1.0 - smoothstep(-0.8, 0.8, d);
    c = mix(c, u_slot, inside * 0.92);
    float ring = 1.0 - smoothstep(0.0, 1.4, abs(d) - 0.5);
    c = mix(c, u_line, ring * 0.6);
    float glow = (1.0 - smoothstep(0.0, 10.0, abs(d))) * u_boardGlow;
    c = mix(c, u_glow, glow * 0.75);
  }
  o = vec4(c, 1.0);
}`

/** Board-rect image quad (ghost and completion reveal). */
export const QUAD_VS = /* glsl */ `#version 300 es
uniform vec3 u_cam; uniform vec2 u_view; uniform vec2 u_board;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 scr = p * u_board * u_cam.x + u_cam.yz;
  gl_Position = vec4(scr.x / u_view.x * 2.0 - 1.0, 1.0 - scr.y / u_view.y * 2.0, 0.0, 1.0);
  v_uv = p;
}`

export const QUAD_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_image; uniform float u_alpha; uniform vec2 u_uvMax;
out vec4 o;
void main() { o = vec4(texture(u_image, v_uv * u_uvMax).rgb, u_alpha); }`
