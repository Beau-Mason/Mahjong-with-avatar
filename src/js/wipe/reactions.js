// 局結果ごとの「固定リアクション」定義。
//
//  pose(p): リアクション進行度 p(0..1) に対する“その瞬間”の姿勢を返す。
//    head … 追従姿勢に上書き合成する頭の回転(rad)。{x:pitch, y:yaw, z:roll}
//    expr … 上書きするVRM表情ウェイト
//  実体は手続き的キーフレーム。avatar.js側でフェードイン/アウトの包絡線を掛けて
//  通常追従の上にウェイト合成するため、ここでは「決め打ちの動き」だけを記述する。
//
//  ※ 将来 VRMA(.vrma) のモーションクリップに差し替える場合も、この定義を
//    クリップ再生に置き換えるだけで avatar.js の合成ロジックは流用できる。

const TAU = Math.PI * 2;

export const REACTIONS = {
    // 放銃: 悔しがる。下を向きつつ首を横に振る＋怒り/悔しさの表情。
    houju: {
        text: 'Oh shit…', sound: 'ohshit', duration: 2600, intensity: 1.0,
        pose(p) {
            const shake = Math.sin(p * TAU * 2.5) * 0.22 * (1 - p);  // 横振り（収束）
            return {
                head: { x: 0.28, y: shake, z: 0.05 },               // うつむき＋横振り
                expr: { angry: 0.85, sad: 0.3, surprised: 0.15 * (p < 0.2 ? 1 : 0), blink: 0.2 },
            };
        },
    },
    // 被ツモ: 落胆。がっくりと下を向いてため息。
    tsumora: {
        text: 'うわ…', sound: 'groan', duration: 2400, intensity: 1.0,
        pose(p) {
            const droop = Math.min(1, p * 3);                       // すばやくうなだれる
            return {
                head: { x: 0.45 * droop, y: -0.05, z: -0.08 },
                expr: { sad: 0.9, relaxed: 0.2, blink: 0.5 * droop },
            };
        },
    },
    // 自分の和了: 歓喜。ぱっと上を向いて弾むようにうなずく＋満面の笑み。
    win: {
        text: 'やった！', sound: 'yatta', duration: 2400, intensity: 1.0,
        pose(p) {
            const bounce = Math.sin(p * TAU * 2) * 0.18 * (1 - p * 0.5); // 弾むうなずき
            return {
                head: { x: -0.12 + bounce, y: Math.sin(p * TAU) * 0.1, z: 0 },
                expr: { happy: 1.0, relaxed: 0.3, blink: 0.6 },        // 笑顔（半目）
            };
        },
    },
};
