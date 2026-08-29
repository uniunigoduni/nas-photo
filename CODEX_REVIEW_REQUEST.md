# ローカル Codex 確認依頼: ドラッグ＆ドロップアップロード

## 目的

今回追加した NAS-PHOTO のドラッグ＆ドロップアップロード機能について、ローカル環境でコードレビューとテストをお願いします。

**アプリの起動確認は不要です。GitHub Actions は使用・変更しないでください。`.github/workflows` には触れないでください。**

## 今回の仕様

- ログイン後の画面へファイルまたはフォルダをドラッグ＆ドロップしてアップロードできる。
- フォルダをドロップした場合は再帰的に中身を走査し、NAS-PHOTO が対応しているメディアだけを抽出する。
- 対応形式は既存 `kind()` と揃える。
  - JPG / JPEG / PNG / WebP / BMP / GIF
  - MP4 / MOV / M4V / WebM / MKV / AVI
- 非対応ファイルはエラーにせず除外する。
- 1回のドロップ操作全体を1つの upload batch とする。
- アップロード先をユーザーには選ばせず、登録済み Root の先頭を使用する。
- NASへの最終保存先は以下。

  ```text
  <root>/nas-photo-uploaded/YYYYMMDD/
  ```

- `YYYYMMDD` はサーバー側でバッチを作成した日付。
- ブラウザから届いたデータは、まず実行ファイルと同じディレクトリにある以下へ一時保存する。

  ```text
  nas-photo-upload-temp/<batch-id>/
  ```

- バッチ内の全ファイルがサーバーへ到着するまでは、NAS側への書き込みを開始しない。
- 全ファイル受信後にだけNASへcommitする。
- NASへコピーするときは `.nas-photo-part` の一時名を使用し、コピー完了後に正式名へrenameする。
- 同名ファイルが既にある場合は確認ダイアログを出さず、`_2`, `_3` ... と自動採番する。
- 通信断などで途中失敗した場合、受信済みファイルは同じbatchで再利用する。
- 同じファイル構成を再ドロップした場合、未完了batchを再利用して受信済みファイルを送り直さない。
- 未完了batchは `LastActivityAt` から1時間経過すると自動削除する。
- cleanupは起動時と定期処理で行い、処理中のbatchはbatch lockによって途中削除されないようにする。
- 正常commit後はローカル一時batchを削除し、メディア再スキャンを要求する。
- ユーザーが「破棄」を選んだ場合も一時batchを削除する。

## 主な変更ファイル

- `cmd/nas-photo/upload.go`
  - upload batch API
  - 一時ファイル管理
  - 1時間TTL cleanup
  - resume
  - NAS commit
  - 同名自動採番
  - commit後のrescan
- `cmd/nas-photo/upload_test.go`
  - upload補助ロジックのテスト
- `cmd/nas-photo/main.go`
  - `a.uploadRoutes(m)` の登録
- `cmd/nas-photo/web/upload.js`
  - ファイル／フォルダのドラッグ＆ドロップ
  - フォルダ再帰走査
  - 対応形式抽出
  - upload progress
  - retry / discard
- `cmd/nas-photo/web/upload.css`
  - ドロップ領域と進捗UI
- `cmd/nas-photo/web/index.html`
  - upload assets の読込
- `cmd/nas-photo/web/sw.js`
  - upload assets をPWA shell cacheへ追加

## 確認してほしい項目

### Go

1. `upload.go` が `main` package として問題なくコンパイルできること。
2. `gofmt` が必要な箇所を整形すること。特に `main.go` は今回の直接編集でインデント差分が1箇所あるため、意味を変えずに整形してください。
3. batch ID / file index / filename からパストラバーサルできないこと。
4. クライアントが任意のNASパスを指定できないこと。
5. manifest内の `RootPath` / `TargetName` を含め、永続化データを読み直した場合でも保存先がRoot外へ出ないことを確認すること。
6. `http.MaxBytesReader` と `io.Copy` の組み合わせが、指定サイズより短い／長いリクエストを正しく失敗扱いにできること。
7. 大容量ファイルをメモリへ全読み込みしていないこと。
8. 長時間の1ファイル転送中にcleanupがbatchを消さないこと。
9. `LastActivityAt + 1h` のTTLが期待どおりであること。
10. プロセス再起動後に古いbatchをcleanupできること。
11. commit途中でNASエラーが発生した場合、ローカル側の受信済みデータが残り、commitだけ再試行できること。
12. commit途中でプロセスが停止した場合の `.nas-photo-part` と一部rename済みファイルの再試行挙動を重点的に確認すること。
13. 同名ファイルの自動採番が、同一batch内と既存ファイルの両方で衝突しないこと。
14. Windows / Linux での `os.Rename`、ファイル名の大文字小文字、実行ファイル横ディレクトリの扱いを確認すること。
15. 複数commitが近いタイミングで発生した場合、`scheduleUploadRescan()` が不要な競合や取りこぼしを起こさないこと。
16. batch lock の `sync.Map` からの削除タイミングにraceがないこと。
17. Root設定変更中の未完了batchが安全に失敗すること。

### Browser / JavaScript

1. 通常ファイルのドロップが動くことを静的に確認すること。
2. フォルダドロップ時にサブフォルダを再帰走査すること。
3. `webkitGetAsEntry()` と `getAsFileSystemHandle()` のfallback関係を確認すること。
4. 同じフォルダを再ドロップした場合にファイル順序が安定し、サーバーのbatch再利用条件と一致すること。
5. 非対応ファイルだけのフォルダでbatchを作成しないこと。
6. upload途中失敗→再試行で、受信済みファイルをskipすること。
7. commit失敗→再試行で、ブラウザからファイルを再送せずcommitへ進めること。
8. TTL切れ後の再試行で新しいbatchを作成できること。
9. 「破棄」で進行中XHRをabortし、サーバー側batch削除へ進むこと。
10. 複数回のドロップを同時に行った場合のUI状態競合を確認し、必要なら1batchずつに制限すること。
11. dragleave時にoverlayが残るケースがないか確認すること。
12. PWA / Service Worker のキャッシュ更新が `upload.js` / `upload.css` を含むこと。

## 実行してほしい確認コマンド

アプリ自体は起動せず、以下の範囲でお願いします。

```bash
gofmt -w cmd/nas-photo/main.go cmd/nas-photo/upload.go cmd/nas-photo/upload_test.go
go test ./...
```

Node.js が利用できる場合は追加で以下もお願いします。

```bash
node --check cmd/nas-photo/web/upload.js
```

必要であれば、upload APIについて `httptest` を使ったユニット／結合テストを追加してください。ただし実NASやアプリ起動を前提にしないテストにしてください。

## 特に優先して見てほしい点

最優先は以下です。

1. **途中失敗しても重複アップロードを要求しないこと**
2. **全ファイルがサーバーへ到着する前にNASへ書かないこと**
3. **1時間放置されたローカル一時ファイルが残り続けないこと**
4. **NAS commit途中失敗から安全に再試行できること**
5. **パス操作でRoot外へ書けないこと**
6. **フォルダドロップで対応メディアだけを再帰抽出できること**

レビューで問題を見つけた場合は、上記仕様を維持したまま修正してください。
