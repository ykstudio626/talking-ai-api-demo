import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import type { Object3D } from 'three';
import './types'; // Window グローバル型を適用

// @pixiv/three-vrm が参照する three の型インスタンスと
// 直接インポートした three の型インスタンスが異なる場合の型ガード
function isVRM(obj: unknown): obj is VRM {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'expressionManager' in obj &&
    'update' in obj &&
    'humanoid' in obj &&
    'scene' in obj
  );
}

const VRM_PATH = '/model-data/6055378321192136326.vrm';

// レンダラー
const canvas = document.getElementById('avatarCanvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
camera.position.set(0, 1.5, 1.5);
camera.lookAt(new THREE.Vector3(0, 1.5, 0));

// OrbitControls
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.minDistance   = 0.5;
controls.maxDistance   = 5.0;

// Canvas リサイズ追従
function onResize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
onResize();
new ResizeObserver(onResize).observe(canvas);

// ライティング
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1, 2, 2);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

// VRM（型ガード経由で使用）
let vrm: unknown = null;
let bones: Record<string, Object3D | null> = {};

const loader = new GLTFLoader();
loader.register(parser => new VRMLoaderPlugin(parser));

loader.load(
  VRM_PATH,
  (gltf: GLTF) => {
    vrm = gltf.userData['vrm'];
    if (!isVRM(vrm)) return;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    vrm.scene.rotation.y = Math.PI;
    scene.add(vrm.scene);

    // 腕を下ろす
    const leftArm  = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    if (leftArm)  leftArm.rotation.z  =  1.4;
    if (rightArm) rightArm.rotation.z = -1.4;

    bones = {
      hips:  vrm.humanoid.getNormalizedBoneNode('hips'),
      spine: vrm.humanoid.getNormalizedBoneNode('spine'),
      head:  vrm.humanoid.getNormalizedBoneNode('head'),
    };

    const loadingEl = document.getElementById('avatarLoading');
    if (loadingEl) loadingEl.style.display = 'none';
    console.log('✅ VRM loaded');
  },
  () => { /* progress: 使用しない */ },
  (error: unknown) => {
    const loadingEl = document.getElementById('avatarLoading');
    if (loadingEl) loadingEl.style.display = 'none';
    console.error('❌ VRM load error:', error);
  },
);

// アニメーションループ
const clock = new THREE.Clock();
const T_COEF = 3;

(function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  const delta = clock.getDelta();
  const t     = clock.getElapsedTime();

  if (!isVRM(vrm)) {
    renderer.render(scene, camera);
    return;
  }
  const currentVrm = vrm;
  {
    if (window.avatarPaused) {
      // ニュートラルポーズにリセット
      currentVrm.expressionManager?.setValue('aa', 0);
      currentVrm.expressionManager?.setValue('A',  0);
      currentVrm.expressionManager?.setValue('blink',      0);
      currentVrm.expressionManager?.setValue('blinkLeft',  0);
      currentVrm.expressionManager?.setValue('blinkRight', 0);
      currentVrm.expressionManager?.setValue('Blink',      0);
      if (bones['spine']) bones['spine'].rotation.x = 0;
      if (bones['hips'])  { bones['hips'].rotation.z = 0; bones['hips'].rotation.x = 0; }
      if (bones['head'])  { bones['head'].rotation.y = 0; bones['head'].rotation.z = 0; }
    } else {
      // 口パク
      const rms      = window.currentRms || 0;
      const mouthVal = Math.min(1.0, rms / 25);
      currentVrm.expressionManager?.setValue('aa', mouthVal);
      currentVrm.expressionManager?.setValue('A',  mouthVal);

      // アイドルアニメーション
      if (bones['spine']) {
        bones['spine'].rotation.x = Math.sin(t * 0.5 * T_COEF) * 0.018;
      }
      if (bones['hips']) {
        bones['hips'].rotation.z = Math.sin(t * 0.35 * T_COEF) * 0.012
                                 + Math.sin(t * 0.13 * T_COEF) * 0.006;
        bones['hips'].rotation.x = Math.sin(t * 0.28 * T_COEF) * 0.008;
      }
      if (bones['head']) {
        bones['head'].rotation.y = Math.sin(t * 0.22 * T_COEF) * 0.018
                                 + Math.sin(t * 0.07 * T_COEF) * 0.010;
        bones['head'].rotation.z = Math.sin(t * 0.31 * T_COEF) * 0.012;
      }

      // まばたき
      const blinkPhase = t % 5;
      const blinkVal   = blinkPhase < 0.15
        ? Math.sin((blinkPhase / 0.15) * Math.PI)
        : 0;
      currentVrm.expressionManager?.setValue('blink',      blinkVal);
      currentVrm.expressionManager?.setValue('blinkLeft',  blinkVal);
      currentVrm.expressionManager?.setValue('blinkRight', blinkVal);
      currentVrm.expressionManager?.setValue('Blink',      blinkVal);
    }

    currentVrm.update(delta);
  }

  renderer.render(scene, camera);
})();
