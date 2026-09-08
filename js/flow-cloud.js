import * as THREE from "three";

const INK = new THREE.Color("#1C1B19");
const SURPLUS = new THREE.Color("#1B4332");
const DEFICIT = new THREE.Color("#7A1F2B");

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isMobile() {
  return window.matchMedia("(max-width: 860px)").matches;
}

function particleCount() {
  return isMobile() ? 260 : 760;
}

export function createFlowCloud(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  camera.position.set(0, 0.06, 3.35);

  const ambient = new THREE.AmbientLight(0xf4f1ea, 1.15);
  scene.add(ambient);

  const lamp = new THREE.PointLight(0xfff3dc, 14, 8, 1.6);
  lamp.position.set(1.35, 1.2, 2.2);
  scene.add(lamp);

  const count = particleCount();
  const seeds = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    seeds[i] = {
      phi: Math.acos(1 - 2 * t),
      theta: Math.PI * (1 + Math.sqrt(5)) * i,
      radius: 1.06 + ((i * 17) % 13) * 0.013,
      wobble: (i % 11) * 0.37,
      speed: 0.55 + ((i * 13) % 10) * 0.07,
    };
  }

  const geometry = new THREE.SphereGeometry(isMobile() ? 0.028 : 0.02, 7, 6);
  const material = new THREE.MeshStandardMaterial({
    color: 0x1c1b19,
    emissive: 0x1c1b19,
    emissiveIntensity: 0.18,
    roughness: 0.68,
    metalness: 0.03,
    transparent: true,
    opacity: 0.94,
  });

  const cloud = new THREE.InstancedMesh(geometry, material, count);
  cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cloud);

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const currentColor = INK.clone();
  const targetColor = INK.clone();
  const lampWarm = new THREE.Color(0xfff3dc);

  for (let i = 0; i < count; i += 1) {
    cloud.setColorAt(i, INK);
  }

  let density = 0.18;
  let targetDensity = 0.18;
  let orbit = 0.12;
  let targetOrbit = 0.12;
  let raf = 0;
  let last = performance.now();
  let disposed = false;

  function resize() {
    const parent = canvas.parentElement;
    const w = Math.max(parent?.clientWidth || canvas.clientWidth || 1, 1);
    const h = Math.max(parent?.clientHeight || canvas.clientHeight || 1, 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setBalance(balance, income) {
    const ratio = income > 0 ? balance / income : balance === 0 ? 0 : -1;
    const clamped = Math.max(-1, Math.min(1, ratio));

    if (clamped > 0) {
      targetColor.copy(SURPLUS);
      targetDensity = 0.3 + clamped * 0.7;
      targetOrbit = 0.22 + clamped * 1.15;
    } else if (clamped < 0) {
      targetColor.copy(DEFICIT);
      targetDensity = 0.16 + Math.abs(clamped) * 0.22;
      targetOrbit = 0.08 + Math.abs(clamped) * 0.18;
    } else {
      targetColor.copy(INK);
      targetDensity = 0.2;
      targetOrbit = 0.1;
    }
  }

  function tick(now) {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const ease = prefersReducedMotion() ? 1 : 1 - Math.exp(-dt * 3.2);
    currentColor.lerp(targetColor, ease);
    density += (targetDensity - density) * ease;
    orbit += (targetOrbit - orbit) * ease;
    lamp.color.copy(currentColor).lerp(lampWarm, 0.4);
    lamp.intensity = 10 + density * 12;
    material.color.copy(currentColor);
    material.emissive.copy(currentColor);
    material.emissiveIntensity = 0.16 + density * 0.22;

    const visible = Math.floor(THREE.MathUtils.lerp(count * 0.26, count, density));
    const time = now * 0.001;
    const reduced = prefersReducedMotion();

    for (let i = 0; i < count; i += 1) {
      const s = seeds[i];
      const spin = reduced ? s.theta : s.theta + time * orbit * s.speed;
      const nod = reduced ? 0 : Math.sin(time * 0.55 + s.wobble) * 0.045;
      const rad = s.radius * (0.86 + density * 0.22);
      const phi = s.phi + nod;

      dummy.position.set(
        Math.sin(phi) * Math.cos(spin) * rad,
        Math.cos(phi) * rad,
        Math.sin(phi) * Math.sin(spin) * rad
      );
      dummy.scale.setScalar(i < visible ? 0.65 + density * 0.7 : 0.001);
      dummy.updateMatrix();
      cloud.setMatrixAt(i, dummy.matrix);

      const shade = 0.78 + ((i % 7) * 0.035);
      tint.copy(currentColor).multiplyScalar(shade);
      cloud.setColorAt(i, tint);
    }

    cloud.instanceMatrix.needsUpdate = true;
    if (cloud.instanceColor) cloud.instanceColor.needsUpdate = true;
    cloud.rotation.y = reduced ? 0.12 : time * (0.04 + orbit * 0.08);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement || canvas);
  resize();
  raf = requestAnimationFrame(tick);

  return {
    setBalance,
    resize,
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
