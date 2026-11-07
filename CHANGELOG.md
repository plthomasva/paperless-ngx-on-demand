# Changelog

## [1.2.0](https://github.com/plthomasva/paperless-ngx-on-demand/compare/paperless-ngx-on-demand-v1.1.3...paperless-ngx-on-demand-v1.2.0) (2026-11-07)


### Features

* **mail:** check mail on boot and every 2m, auto-generate missing thumbnails ([dd3657c](https://github.com/plthomasva/paperless-ngx-on-demand/commit/dd3657c8b9a51b8831763e7fd2949fca5c5973ca))


### Bug Fixes

* **csrf:** redact hardcoded domains from changelog and make CSRF origins dynamically derived from DOMAIN_NAME ([0e92404](https://github.com/plthomasva/paperless-ngx-on-demand/commit/0e92404f5d8bbc644cc71a03cc2658edad947ec5))

## [1.1.3](https://github.com/plthomasva/paperless-ngx-on-demand/compare/paperless-ngx-on-demand-v1.1.2...paperless-ngx-on-demand-v1.1.3) (2026-11-07)


### Bug Fixes

* **csrf:** forward viewer host through CloudFront and configure trusted origins for custom domain ([150d36b](https://github.com/plthomasva/paperless-ngx-on-demand/commit/150d36b6e50fba8f41f4bb8bf180e15753c1b7d9))

## [1.1.2](https://github.com/plthomasva/paperless-ngx-on-demand/compare/paperless-ngx-on-demand-v1.1.1...paperless-ngx-on-demand-v1.1.2) (2026-11-06)


### Bug Fixes

* **wakeup:** calibrate wakeup splash screen timing to real 45-60s boot cycle and add progressive stage indicators ([7bf8eab](https://github.com/plthomasva/paperless-ngx-on-demand/commit/7bf8eab55b8c581813cd888ac5a49219c6f67c34))

## [1.1.1](https://github.com/plthomasva/paperless-ngx-on-demand/compare/paperless-ngx-on-demand-v1.1.0...paperless-ngx-on-demand-v1.1.1) (2026-11-06)


### Bug Fixes

* **ci:** correct job-level conditional syntax in release workflow ([f619824](https://github.com/plthomasva/paperless-ngx-on-demand/commit/f6198244e79286ee996c79f789b18c034a30e6f1))
* **ci:** support immutable repository ID in OIDC trust policy ([fb2d2a3](https://github.com/plthomasva/paperless-ngx-on-demand/commit/fb2d2a37c1fcb364b82baccf30cdcdc278c9275b))
* **wakeup:** resolve SigV4a signing, mount-s3 FUSE options, and origin secret synchronization ([36edfc3](https://github.com/plthomasva/paperless-ngx-on-demand/commit/36edfc3d59ea0c8557cefb44dc1262d15e5a01c9))

## [1.1.0](https://github.com/plthomasva/paperless-ngx-on-demand/compare/paperless-ngx-on-demand-v1.0.0...paperless-ngx-on-demand-v1.1.0) (2026-11-06)


### Features

* add ACM certificate and custom domain routing support for paperless.example.com ([2913186](https://github.com/plthomasva/paperless-ngx-on-demand/commit/2913186518642911a829404091ba433c69796d42))
* add interactive setup wizard, auto-namespaced buckets, and local gitignored configuration ([eec23e5](https://github.com/plthomasva/paperless-ngx-on-demand/commit/eec23e5c181e40f2f66b4302ed9754542556efee))
* add official Paperless favicon, crawler defense, and JS-initiated wakeup ([b0c0572](https://github.com/plthomasva/paperless-ngx-on-demand/commit/b0c0572bc9fbc93f40388c038bd5825ee99c47ed))
* **ci:** add CI quality checking, release management, CC-BY-NC licensing, and quality badges ([4e48510](https://github.com/plthomasva/paperless-ngx-on-demand/commit/4e485103fa3578faaf32612142b90f71975fafdf))
* initial on-demand paperless-ngx aws cdk architecture ([414e996](https://github.com/plthomasva/paperless-ngx-on-demand/commit/414e996ac2f2755dd440c318b9381ca2a759b6f2))
* support unified existing S3 storage bucket for media and inbox ([c67f173](https://github.com/plthomasva/paperless-ngx-on-demand/commit/c67f173da436d2fffc80bba2a95cfade850224fe))


### Bug Fixes

* **build:** configure outDir dist in tsconfig to isolate transpiled artifacts from coverage and sonar analysis ([7bdbc52](https://github.com/plthomasva/paperless-ngx-on-demand/commit/7bdbc522b675fecb50f522f4ab0842a08651bdeb))
* **ci:** patch spawnSync stdio for Stryker sandbox runner and ignore build artifacts ([00a52c7](https://github.com/plthomasva/paperless-ngx-on-demand/commit/00a52c75ac6ff259de569ea25090e0afb9b83197))
* remove hardcoded domain and bucket references, add automated S3 runtime deployment ([011f563](https://github.com/plthomasva/paperless-ngx-on-demand/commit/011f56395872bf1443b95c72792e7b4582228cd8))
* **routing:** resolve cloudfront origin rewrite, csrf trusted origins, and legacy fixture imports ([1e55fd9](https://github.com/plthomasva/paperless-ngx-on-demand/commit/1e55fd976b33dc68e23b8d59e3c599599671461e))
* **security:** resolve SonarCloud security rules and Gitleaks pattern ([9656a93](https://github.com/plthomasva/paperless-ngx-on-demand/commit/9656a935ef9937c92033d0de79cbe8c2adac052b))
* **security:** sanitize wakeup page redirect path and remove shell spawn execution ([e210744](https://github.com/plthomasva/paperless-ngx-on-demand/commit/e210744bd293fd14ec38d72ed6546ffa85bc5059))
* switch to mount-s3, support S3 Account Regional Namespaces, and prevent wakeup cycling ([051e59d](https://github.com/plthomasva/paperless-ngx-on-demand/commit/051e59d5dfc5eaaea6870dd6d5bf80223b629e74))
* **watchdog:** ignore S3 zero-byte folder markers and exclude static crawlers from activity log ([e69bed3](https://github.com/plthomasva/paperless-ngx-on-demand/commit/e69bed3f9dbae88beedff79add10c3c7d1ae5d44))
* **watchdog:** preserve access.log mtime on service restart and guard numeric defaults ([1b27cb5](https://github.com/plthomasva/paperless-ngx-on-demand/commit/1b27cb58d882f115512702fe363dc6f3d91aec61))
* **watchdog:** replace post-increment arithmetic with safe addition to prevent set -e exit ([bae3506](https://github.com/plthomasva/paperless-ngx-on-demand/commit/bae350664acefb7a0e52cfc7db01597c96c3dcb7))
