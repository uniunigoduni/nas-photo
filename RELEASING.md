# NAS-PHOTOのリリース

`v`から始まるGitタグをGitHubへプッシュすると、GitHub Actionsがテストとクロスコンパイルを実行し、同名のGitHub Releaseを自動作成します。

Releaseには次の2ファイルだけが添付されます。

- `nas-photo-windows-amd64.exe`: Windows x64用
- `nas-photo-linux-arm64`: Raspberry PiなどのLinux arm64用

例えば`v0.1.0`を公開する場合は、公開したいコミット上で次を実行します。

```powershell
git tag v0.1.0
git push origin v0.1.0
```

同じタグのワークフローを再実行した場合は、既存Releaseの2ファイルが新しいビルドで置き換えられます。

Linux版はダウンロード後に実行権限を付けてください。

```bash
chmod +x nas-photo-linux-arm64
```

動画のサムネイル生成には、実行先OSへ別途`ffmpeg`をインストールする必要があります。
