BINARY_NAME=molt
VERSION=0.1.0

.PHONY: all build clean test release

all: build

build:
	go build -ldflags "-X main.version=$(VERSION)" -o $(BINARY_NAME) .

# Build for all platforms
release: clean
	mkdir -p dist
	# macOS
	GOOS=darwin GOARCH=amd64 go build -ldflags "-X main.version=$(VERSION)" -o dist/$(BINARY_NAME)-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 go build -ldflags "-X main.version=$(VERSION)" -o dist/$(BINARY_NAME)-darwin-arm64 .
	# Linux
	GOOS=linux GOARCH=amd64 go build -ldflags "-X main.version=$(VERSION)" -o dist/$(BINARY_NAME)-linux-amd64 .
	GOOS=linux GOARCH=arm64 go build -ldflags "-X main.version=$(VERSION)" -o dist/$(BINARY_NAME)-linux-arm64 .
	# Windows
	GOOS=windows GOARCH=amd64 go build -ldflags "-X main.version=$(VERSION)" -o dist/$(BINARY_NAME)-windows-amd64.exe .

clean:
	rm -f $(BINARY_NAME)
	rm -rf dist

test:
	go test -v ./...

install:
	go install -ldflags "-X main.version=$(VERSION)" .
