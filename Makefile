# Thin CLI entrypoint. See caty-ai/x-collector#36 / campaign family-os#56 B2.
# deps: the family reusable CI gate (test-lint@ci-v1) runs make on a bare
# checkout — install pinned dependencies only when node_modules is absent.

.PHONY: test lint deps

deps:
	@[ -d node_modules ] || npm ci

test: deps
	npm test
	# Publication gate (#40): selftest + live gate — same path locally and in the family test-lint CI (make test).
	python3 -B tools/check_publication_gate.py --selftest
	python3 -B tools/check_publication_gate.py --root . --account-slug shojikumaru

lint: deps
	npx tsc --noEmit
	npx tsc --noEmit -p tsconfig.community.json
