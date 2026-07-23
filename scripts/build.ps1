$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force dist | Out-Null
go test ./...
go build -trimpath -o dist/nas-photo.exe ./cmd/nas-photo
$env:CGO_ENABLED='0'; $env:GOOS='linux'; $env:GOARCH='arm64'
go build -trimpath -o dist/nas-photo-linux-arm64 ./cmd/nas-photo
