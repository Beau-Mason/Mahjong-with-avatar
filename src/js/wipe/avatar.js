// avatar条件: トゥーン調VRMアバターをワイプに描画する。
//
//  通常時 … カメラ映像をMediaPipe FaceLandmarkerで解析し、顔の向き(首/頭の傾き)・
//           瞬き・口の開きをVRMにリアルタイム反映（VTuber / Zoomアバター方式）。
//  局結果 … react()で「悔しがる」等の固定リアクションを、通常追従の上に
//           ウェイトでクロスフェードして“シームレスに”重ねる。
//
//  必要アセット（dist/ 配下に自己ホスト）:
//    dist/avatar/<name>.vrm            … VRoid Studio等で書き出したVRMモデル
//    dist/mediapipe/wasm/*             … @mediapipe/tasks-vision のwasm一式
//    dist/mediapipe/face_landmarker.task … 顔ランドマークモデル
//  （導入手順は本ファイル末尾のコメント、およびREADME参照）

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import { REACTIONS } from './reactions';

const WASM_PATH  = 'mediapipe/wasm';
const MODEL_TASK = 'mediapipe/face_landmarker.task';
const VRM_DIR    = 'avatar';

// blendshape配列を {name: score} の辞書に
function toMap(categories) {
    const m = {};
    for (const c of categories) m[c.categoryName] = c.score;
    return m;
}
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp    = (a, b, t) => a + (b - a) * t;

export class AvatarWipe {
    constructor(root, cond) {
        this._root = $(root);
        this._cond = cond || {};
        this._video = this._root.find('video').get(0);

        // 描画用canvasをワイプ内に追加（videoはMediaPipe入力源として隠す）
        this._root.addClass('avatar');
        this._canvas = document.createElement('canvas');
        this._canvas.className = 'avatar-canvas';
        this._root.append(this._canvas);
        this._bubble = this._root.find('.bubble');

        this._vrm = null;
        this._landmarker = null;
        this._lastVideoTime = -1;
        this._raf = null;
        this._prevT = 0;

        // 追従値（スムージング用に保持）
        this._head = { x: 0, y: 0, z: 0 };   // 頭の傾き(rad)
        this._expr = {};                      // 表情ウェイト

        // リアクション状態
        this._reaction = null;   // { def, t0, dur }
        this._sound = {
            ohshit: new Audio('audio/ohshit.wav'),
            groan:  new Audio('audio/groan.wav'),
            yatta:  new Audio('audio/yatta.wav'),
        };

        this._initThree();
    }

    // ---- three.js シーン構築 ----
    _initThree() {
        const w = this._root.width()  || 180;
        const h = this._root.height() || 135;
        const renderer = new THREE.WebGLRenderer(
                            { canvas: this._canvas, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h, false);
        this._renderer = renderer;

        const scene = new THREE.Scene();
        this._scene = scene;

        // 顔〜肩が収まるポートレート構図（webカメラ風）
        const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 20);
        camera.position.set(0, 1.32, 0.85);
        camera.lookAt(0, 1.30, 0);
        this._camera = camera;

        scene.add(new THREE.AmbientLight(0xffffff, 1.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(0.5, 2, 1.2);
        scene.add(dir);

        // ワイプの大きさが変わったら(ウィンドウリサイズ等)解像度とアスペクトを追従
        this._onResize = () => this._resize();
        $(window).on('resize.avatarwipe', this._onResize);
    }

    _resize() {
        const w = this._root.width()  || 180;
        const h = this._root.height() || 135;
        this._renderer.setSize(w, h, false);
        this._camera.aspect = w / h;
        this._camera.updateProjectionMatrix();
    }

    async start() {
        await Promise.all([ this._loadVRM(), this._initLandmarker(), this._openCamera() ]);
        this._prevT = performance.now();
        this._loop();
    }

    async _loadVRM() {
        const url = `${VRM_DIR}/${this._cond.avatar || 'default'}.vrm`;
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const gltf = await loader.loadAsync(url);
        const vrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.rotateVRM0(vrm);                // VRM0をVRM1と同じ向きに正規化（VRM1は無変化）
        // 正規化後はカメラ(+Z側)の方を向くので追加回転は不要
        this._scene.add(vrm.scene);
        this._vrm = vrm;
        this._restPose();        // Tポーズの腕を体側へ下ろす
        vrm.update(0);           // 姿勢を反映してからボーン位置を取得
        this._frameToHead();     // 頭基準でカメラ構図を決定（見切れ防止・少し下げる）
    }

    // ロード直後の自然な静止姿勢（腕を下ろす）
    _restPose() {
        const h = this._vrm.humanoid;
        const set = (name, x, y, z) => {
            const b = h.getNormalizedBoneNode(name);
            if (b) b.rotation.set(x, y, z);
        };
        // Tポーズ(腕が水平)を基準に、上腕を体側へ約69°下ろす
        set('leftUpperArm',  0, 0, -1.2);
        set('rightUpperArm', 0, 0,  1.2);
    }

    // 頭ボーンの位置を基準にカメラを配置（頭が上端で見切れないようヘッドルームを確保）
    _frameToHead() {
        const head = this._vrm.humanoid.getNormalizedBoneNode('head');
        this._vrm.scene.updateMatrixWorld(true);
        const hp = new THREE.Vector3();
        if (head) head.getWorldPosition(hp);
        if (! head || ! isFinite(hp.y) || hp.y < 0.5) hp.set(0, 1.35, 0);  // フォールバック
        const cam = this._camera;
        cam.fov = 30;
        cam.position.set(hp.x, hp.y + 0.02, hp.z + 1.1);   // 肩まで入る引き
        cam.lookAt(hp.x, hp.y + 0.02, hp.z);               // 注視点≒頭の中心→頭は上寄りだが見切れない
        cam.updateProjectionMatrix();
    }

    async _initLandmarker() {
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
        const opts = (delegate) => ({
            baseOptions: { modelAssetPath: MODEL_TASK, delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
        });
        // 参加者のマシン差を吸収: GPUが使えなければCPUにフォールバック
        try {
            this._landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
        } catch (e) {
            console.warn('FaceLandmarker GPU init failed, retrying on CPU:', e);
            this._landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
        }
    }

    async _openCamera() {
        const stream = await navigator.mediaDevices
                             .getUserMedia({ video: { width: 320, height: 240 }, audio: false });
        this._video.srcObject = stream;
        this._video.style.display = 'none';      // 映像自体は出さない（解析専用）
        await this._video.play();
    }

    // ---- メインループ ----
    _loop() {
        this._raf = requestAnimationFrame(() => this._loop());
        const now = performance.now();
        const delta = (now - this._prevT) / 1000;
        this._prevT = now;

        this._track(now);                 // カメラ→追従ターゲット更新
        this._applyPose(now);             // 追従＋リアクションをVRMへ反映
        if (this._vrm) this._vrm.update(delta);
        this._renderer.render(this._scene, this._camera);
    }

    // カメラ画像から頭の向き・表情ターゲットを推定
    _track(now) {
        if (! this._landmarker || this._video.readyState < 2) return;
        if (this._video.currentTime === this._lastVideoTime) return;
        this._lastVideoTime = this._video.currentTime;

        const res = this._landmarker.detectForVideo(this._video, now);
        const hasFace = res.faceBlendshapes && res.faceBlendshapes.length;

        // --- 頭の向き（変換行列から） ---
        if (res.facialTransformationMatrixes && res.facialTransformationMatrixes.length) {
            const m = new THREE.Matrix4().fromArray(res.facialTransformationMatrixes[0].data);
            const e = new THREE.Euler().setFromRotationMatrix(m, 'YXZ');
            // 鏡像表示に合わせて yaw / roll を反転、可動域をクランプ
            const tx = THREE.MathUtils.clamp(-e.x, -0.5, 0.5);   // pitch(うなずき)
            const ty = THREE.MathUtils.clamp(-e.y, -0.6, 0.6);   // yaw(左右)
            const tz = THREE.MathUtils.clamp( e.z, -0.4, 0.4);   // roll(かしげ)
            this._head.x = lerp(this._head.x, tx, 0.4);
            this._head.y = lerp(this._head.y, ty, 0.4);
            this._head.z = lerp(this._head.z, tz, 0.4);
        }

        // --- 表情（blendshape → VRM expression） ---
        if (hasFace) {
            const b = toMap(res.faceBlendshapes[0].categories);
            const blink = clamp01(Math.max(b.eyeBlinkLeft||0, b.eyeBlinkRight||0) * 1.2);
            const smile = clamp01(((b.mouthSmileLeft||0) + (b.mouthSmileRight||0)) / 2 * 1.4);
            const set = {
                blink,
                aa:    clamp01((b.jawOpen||0) * 1.3),
                ou:    clamp01((b.mouthPucker||0) * 1.2),
                ih:    clamp01(smile * 0.4),
                happy: clamp01(smile),
            };
            for (const k in set) this._expr[k] = lerp(this._expr[k]||0, set[k], 0.5);
        }
    }

    // 追従姿勢に、進行中リアクションをウェイト合成してVRMへ適用
    _applyPose(now) {
        const vrm = this._vrm;
        if (! vrm) return;

        // 追従ベース
        let hx = this._head.x, hy = this._head.y, hz = this._head.z;
        const expr = Object.assign({}, this._expr);

        // リアクション合成（クロスフェード）
        if (this._reaction) {
            const r = this._reaction;
            const p = (now - r.t0) / r.dur;            // 0..1
            if (p >= 1) {
                this._reaction = null;
                this._bubble.removeClass('show');
                this._root.removeClass('houju tsumora win');
            } else {
                const w = envelope(p) * (r.def.intensity || 1);   // フェードイン/アウト
                const pose = r.def.pose(p);                       // 固定アニメの瞬間値
                hx = lerp(hx, pose.head.x, w);
                hy = lerp(hy, pose.head.y, w);
                hz = lerp(hz, pose.head.z, w);
                for (const k in pose.expr)
                    expr[k] = lerp(expr[k] || 0, pose.expr[k], w);
            }
        }

        // 頭の回転は首と頭で分担（自然な見え方）
        const neck = vrm.humanoid.getNormalizedBoneNode('neck');
        const head = vrm.humanoid.getNormalizedBoneNode('head');
        if (neck) neck.rotation.set(hx * 0.4, hy * 0.4, hz * 0.4);
        if (head) head.rotation.set(hx * 0.6, hy * 0.6, hz * 0.6);

        // 表情を反映（前フレームの値はreset目的で主要キーを0埋め）
        const em = vrm.expressionManager;
        if (em) {
            const keys = ['blink','aa','ih','ou','ee','oh',
                          'happy','angry','sad','relaxed','surprised'];
            for (const k of keys) em.setValue(k, expr[k] || 0);
        }
    }

    // ---- 局結果リアクション ----
    react(type) {
        const def = REACTIONS[type];
        if (! def) return;
        this._reaction = { def, t0: performance.now(), dur: def.duration || 2500 };
        this._root.removeClass('houju tsumora win').addClass(type);
        if (def.text) this._bubble.text(def.text).addClass('show');
        const a = this._sound[def.sound];
        if (a) { a.currentTime = 0; a.play().catch(()=>{}); }
    }

    dispose() {
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this._onResize) $(window).off('resize.avatarwipe', this._onResize);
        if (this._video && this._video.srcObject)
            this._video.srcObject.getTracks().forEach(t => t.stop());
        if (this._landmarker) this._landmarker.close();
        if (this._renderer) this._renderer.dispose();
    }
}

// フェードイン(0→1)→保持→フェードアウト(1→0)の包絡線
function envelope(p) {
    const IN = 0.12, OUT = 0.78;
    if (p < IN)  return p / IN;
    if (p > OUT) return (1 - p) / (1 - OUT);
    return 1;
}
