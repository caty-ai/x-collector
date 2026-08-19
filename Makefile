# Thin CLI entrypoint. See caty-ai/x-collector#36 / campaign family-os#56 B2.

.PHONY: test lint

test:
	npm test

lint:
	npx tsc --noEmit
	npx tsc --noEmit -p tsconfig.community.json
