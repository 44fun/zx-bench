import { useEffect, useRef } from 'react';
import { useTheme } from '../theme';

/**
 * AnimatedBackground — WebGL 网格背景（性能优化版）
 *
 * 优化措施：
 * 1. 页面不可见时暂停渲染（visibilitychange）
 * 2. 帧率限制到 ~30fps（每两帧渲染一次），降低 GPU 占用
 * 3. DPR 上限从 2 降到 1.5，减少着色器像素计算量
 * 4. 支持 prefers-reduced-motion：完全停止动画，只绘制一帧静态背景
 * 5. 鼠标交互节流（rAF 内自然合并，无需额外节流）
 */
export default function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { mode } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 尊重用户的减少动画偏好
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false, // 关闭抗锯齿，减少 GPU 开销
      premultipliedAlpha: false,
      powerPreference: 'low-power', // 请求低功耗 GPU
    });
    if (!gl) return;

    const VS = `attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}`;

    const FS = `precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_dark;
uniform vec3 u_accent;

float gridLine(vec2 uv, float spacing, float thickness){
  vec2 g = abs(fract(uv / spacing) - 0.5);
  float d = min(g.x, g.y);
  return 1.0 - smoothstep(thickness - 0.005, thickness + 0.005, d);
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = uv;
  p.x *= aspect;

  vec2 drift = vec2(u_time * 0.008, u_time * 0.005);
  vec2 gp = p + drift;

  float mainGrid = gridLine(gp, 0.12, 0.012);
  float subGrid = gridLine(gp, 0.024, 0.04) * 0.4;

  vec2 m = u_mouse;
  m.x *= aspect;
  float md = length(p - m);
  float mInfluence = exp(-md * 4.0) * 0.5;

  float gridStrength = (mainGrid + subGrid * 0.5) * (0.45 + mInfluence);

  vec2 dotGrid = fract(gp * 50.0) - 0.5;
  float dotMask = 1.0 - smoothstep(0.05, 0.14, length(dotGrid));
  float wave = sin(gp.x * 1.4 + u_time * 0.15) * cos(gp.y * 1.6 - u_time * 0.12);
  dotMask *= smoothstep(-0.3, 0.6, wave) * 0.6;

  vec3 lineColor = mix(vec3(0.08), vec3(0.92), u_dark);
  vec3 bgColor = mix(vec3(0.97, 0.97, 0.96), vec3(0.06, 0.06, 0.07), u_dark);

  vec3 col = bgColor;
  col = mix(col, lineColor, gridStrength * 0.55);
  col = mix(col, lineColor, dotMask * 0.35);
  col = mix(col, u_accent, mInfluence * 0.18);

  gl_FragColor = vec4(col, 1.0);
}`;

    const mkShader = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };

    const prog = gl.createProgram();
    if (!prog) return;

    const vs = mkShader(gl.VERTEX_SHADER, VS);
    const fs = mkShader(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;

    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const lRes = gl.getUniformLocation(prog, 'u_resolution');
    const lT = gl.getUniformLocation(prog, 'u_time');
    const lM = gl.getUniformLocation(prog, 'u_mouse');
    const lD = gl.getUniformLocation(prog, 'u_dark');
    const lA = gl.getUniformLocation(prog, 'u_accent');

    // DPR 上限 1.5（从 2 降低），减少 GPU 着色器计算量
    const resize = () => {
      const d = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = window.innerWidth * d;
      canvas.height = window.innerHeight * d;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const mouse = { x: 0.5, y: 0.5 };
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX / window.innerWidth;
      mouse.y = 1 - e.clientY / window.innerHeight;
    };
    window.addEventListener('mousemove', onMouseMove);

    function readAccent(): [number, number, number] {
      const cs = getComputedStyle(document.documentElement);
      const hex = cs.getPropertyValue('--accent').trim() || '#002FA7';
      const m = hex.match(/^#([0-9a-f]{6})$/i);
      if (!m) return [0, 0.18, 0.65];
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    const t0 = Date.now();
    let rafId = 0;
    let frameCount = 0;
    let isVisible = true;

    const render = (t: number) => {
      const accent = readAccent();
      const dark = document.documentElement.getAttribute('data-theme') === 'dark' ? 1 : 0;

      gl.uniform2f(lRes, canvas.width, canvas.height);
      gl.uniform1f(lT, t);
      gl.uniform2f(lM, mouse.x, mouse.y);
      gl.uniform1f(lD, dark);
      gl.uniform3f(lA, accent[0], accent[1], accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    // 如果用户偏好减少动画，只渲染一帧静态背景
    if (prefersReducedMotion) {
      render(0);
      // 主题切换时重新渲染一帧
      const observer = new MutationObserver(() => render(0));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', resize);
        window.removeEventListener('mousemove', onMouseMove);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteBuffer(buf);
      };
    }

    const loop = () => {
      if (!isVisible) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      // 帧率限制：每两帧渲染一次（~30fps），降低 GPU 占用
      frameCount++;
      if (frameCount % 2 === 0) {
        const t = (Date.now() - t0) / 1000;
        render(t);
      }

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // 页面不可见时暂停渲染
    const onVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="swiss-bg-canvas"
      aria-hidden="true"
    />
  );
}
