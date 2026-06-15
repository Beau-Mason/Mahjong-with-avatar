# ワイプ条件（実験用）と トゥーン調VRMアバター

対局中、画面右下のワイプに表示する自己像を **実験条件で出し分ける** ための仕組みと、
A案として実装した **VRMアバター（カメラ顔追従＋局結果リアクション）** の説明。

研究目的: ワイプに映る自己像の表現方法が、放銃・被ツモ・和了時の tilt / 続行傾向に
与える影響を、以下3条件の被験者間比較で調べる。

| 条件 | `?wipe=` | 内容 |
|------|----------|------|
| アバター | `avatar` | トゥーン調VRMが顔の傾き・瞬き・口を追従。局結果で固定リアクション。 |
| 実映像   | `video`  | 実際のカメラ映像をそのまま表示（従来挙動）。局結果で枠色＋吹き出し＋効果音。 |
| なし     | `none`   | ワイプ非表示・カメラ不要（対照群）。 |

---

## 配信方法（参加者への割り当て）

バックエンド不要の静的Webアプリのまま、**URLクエリで条件を割り当てる**。
研究者が参加者ごとに以下の形のリンクを発行して配布する。

```
https://<host>/index.html?pid=P001&wipe=avatar
https://<host>/index.html?pid=P002&wipe=video
https://<host>/index.html?pid=P003&wipe=none
```

| パラメータ | 値 | 役割 |
|-----------|----|------|
| `wipe` | `avatar` / `video` / `none` | 実験条件。未指定時は `video`（`src/js/wipe/condition.js` の `DEFAULT_MODE`）。 |
| `pid`  | 任意の被験者ID | ログに付与。 |
| `avatar` | VRMファイル名（拡張子なし） | `dist/avatar/<name>.vrm` を読む。未指定は `default`。条件内でモデルを振り分けたい場合に。 |
| `log`  | URL | 指定するとイベントを JSON で逐次 POST（`sendBeacon`）。未指定なら localStorage + console のみ。 |

GitHub Pages / Netlify / S3 などにそのまま載せられる。

## 実験ログ

`src/js/wipe/condition.js` の `Logger` が、条件と局結果イベントを時刻付き(ms)で記録する。

- 既定: `localStorage["Majiang.exp.<pid>"]` に配列で蓄積＋`console.info`。
- `?log=<url>` 指定時: 各レコードを `<url>` へ POST。
- 記録イベント: `session_start`, `reaction`(`type`= houju/tsumora/win)。
  追加で記録したい指標があれば `wipe.log(name, data)` を呼ぶ（`createWipe` の戻り値が公開）。

localStorage の回収例（参加者のブラウザのDevToolsコンソール）:
```js
JSON.parse(localStorage.getItem('Majiang.exp.P001'))
```

---

## 必要アセット（`dist/` に自己ホスト）

オフライン・プライバシー保護のため、トラッキングは端末内で完結。CDNに依存しない。

```
dist/avatar/default.vrm               VRMモデル（顔追従の対象）
dist/mediapipe/wasm/*                 @mediapipe/tasks-vision の wasm 一式
dist/mediapipe/face_landmarker.task   顔ランドマークモデル（約3.7MB）
```

`npm run build:assets`（`build`/`release` から自動実行）で用意される:
- wasm を `node_modules` からコピー
- `face_landmarker.task` を未取得なら Google Storage からダウンロード

これらは `.gitignore` 対象外（`dist/audio` 等と同じ同梱バイナリ扱い）なのでリポジトリに含めて配信する。

### アバターモデルの差し替え

`dist/avatar/default.vrm` を任意のVRMに置き換えるだけ。
**VRoid Studio（無料）** で作成→VRM書き出しが手軽。VRM0/VRM1どちらでも可
（`VRMUtils.rotateVRM0` で向きを正規化済み）。
条件内で複数モデルを使い分けるなら `dist/avatar/<name>.vrm` を置いて `?avatar=<name>`。

---

## 実装構成

```
src/js/wipe.js              ファクトリ。条件で実装を選び {start, react} を返す＋ログ配線。
src/js/wipe/condition.js    URLパラメータ解析・Logger。
src/js/wipe/video.js        video条件（従来のカメラ映像＋枠/吹き出し/効果音）。
src/js/wipe/none.js         none条件（非表示・no-op）。
src/js/wipe/avatar.js       avatar条件。MediaPipe→VRMの顔追従ループ＋リアクション合成。
src/js/wipe/reactions.js    局結果ごとの固定リアクション定義（手続き的キーフレーム）。
src/js/index.js             HumanPlayer.action_hule が houju/win/tsumora を判定し wipe.react()。
```

- 重い three.js / three-vrm / MediaPipe は **avatar条件のときだけ動的import**（webpackチャンク
  `avatar-*.js` / `vendors-*.js`）。video/none の参加者はダウンロードしない。
- どの条件も `{ start(), react(type) }` の同一インターフェース。`index.js` は条件を意識しない。

### 顔追従（avatar.js `_track`）
MediaPipe FaceLandmarker から、
- 頭の向き: `facialTransformationMatrixes` → Euler(YXZ)。鏡像表示に合わせ yaw/roll 反転＋クランプ。
- 表情: `faceBlendshapes`(ARKit52) → VRM表情。`blink`/`aa`(口開き)/`ou`/`happy`(笑み)。

毎フレーム首40%・頭60%に配分して `getNormalizedBoneNode` に適用。

### 局結果リアクション（reactions.js / avatar.js `_applyPose`）
`react(type)` で `reactions.js` の `pose(p)`（進行度0..1の決め打ち動作）を、
フェードイン/アウト包絡線（`envelope`）のウェイトで **通常追従の上にクロスフェード合成**。
追従を止めずに「放銃で悔しがる」等が割り込み、終われば自然に追従へ戻る。

- `houju`: うつむき＋首振り＋怒り/悔しさ
- `tsumora`: がっくりうなだれ＋落胆
- `win`: 弾むうなずき＋満面の笑み

将来 VRMA(.vrma) のモーションクリップに差し替える場合も、`reactions.js` の `pose()` を
クリップ再生へ置換するだけで `_applyPose` の合成ロジックは流用可能。

### 調整ポイント
- カメラ構図: `avatar.js` `_initThree` のカメラ位置/FOV/lookAt（モデルにより要微調整）。
- 追従の効き: `_track` のクランプ範囲・lerp係数、`_applyPose` の首/頭配分。
- リアクションの強さ/長さ: `reactions.js` の `intensity` / `duration` / `pose`。

---

## 動作確認

カメラ顔追従はカメラ許可とユーザー操作（対局開始クリック）を要するため、
実ブラウザでの確認が必要:

1. `npm install && npm run build`
2. `dist/` を静的配信（例: `cd dist && python3 -m http.server 8099`）
3. `http://localhost:8099/index.html?wipe=avatar&pid=test` を **localhost または https** で開く
   （getUserMedia は secure context 必須。本番配信は https 必須）
4. 対局開始 → カメラ許可 → アバターが顔に追従。
5. 対局中 `z`=放銃 / `x`=被ツモ / `c`=和了 のデバッグキーでリアクションを確認
   （`src/js/index.js` の `DEBUG_KEYS`）。
