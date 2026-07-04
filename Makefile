.PHONY: build render dev clean

build:
	npm run build

render:
	go run main.go -skip-fetch

dev:
	npm run dev

clean:
	rm -rf dist src/data/blogroll.json node_modules
