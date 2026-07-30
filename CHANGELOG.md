## [1.0.1](https://github.com/MuhammedResulBilkil/cs2tracker-extension/compare/v1.0.0...v1.0.1) (2026-07-30)


### Bug Fixes

* pin the store's images to the release tag they were reviewed at ([93a8186](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/93a8186793db4aaa32259b323d0f1e2a29aeb66c))

# 1.0.0 (2026-07-25)


### Bug Fixes

* accept mixed-case profile URLs in the lookup box ([94acd6a](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/94acd6a8212a3073b7a611209e61972f46cf29ad))
* anchor Steam URL patterns and bound account id conversion ([8953b49](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/8953b4907bdbe09653da79e3464024779d147a38))
* capture openExternal, pin the per-document observer, harden the id read ([2f17c79](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/2f17c799b9aec2c3222a3a573dc97ba4bfbbd452))
* declare empty packages list so pnpm 10.0-10.4 can install ([1b03c82](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/1b03c8257ae0dbd7d36e143f6da5b9a4eb4045b5))
* give the button a focus ring, a border box, and the stylesheet real tests ([9032ba9](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/9032ba92e40bb37a72e42b1419fa0f57e3066655))
* match stylesheet selectors exactly and correct the parser-error comments ([3d68c51](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/3d68c51b12dbfcbfcab98c392725c14d116841cb))
* mount the friend badge in flow instead of contesting the row corner ([1fc0421](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/1fc0421543d7b2cc1a4866d3026bf29ece9df59b))
* prefer the profile XML over the data-miniprofile scrape ([fe44f26](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/fe44f260ee19569854cd2b91d90419d9effb9ced))
* read settings over the plugin's own RPC instead of Millennium's config API ([0cb16d6](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/0cb16d6efd7367f477e26695199d4d642149b53f))
* read the viewed profile's id from the URL and confine the DOM fallback ([1f08cda](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/1f08cda783042e8f750badba15d31cdf5a95c1b5))
* render settings toggles as switches rather than segmented controls ([6e4da15](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/6e4da15eee9c5af1d88ae8039671b38a67b06a71))
* require the json module Millennium actually preloads ([9de4e02](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/9de4e0265a94101c20ac3a62958b9c474709db76))
* scope the privacy claims to the host each one is about ([3068b87](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/3068b87c8014a03fc8d527c4e08a98521d63be24))
* signal Millennium ready before the backend logs ([11e9485](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/11e9485544bcbbcf47c0601e984596f1732868e6))
* stack each settings toggle under its own label ([5906af8](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/5906af83872e733f6c8a8c4bb2de4d294523cc8e))
* test the teardown chain and the settings decode, and close the arm-after-teardown race ([a904da6](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/a904da612d8311b54290e0423abb85871c9d5e85))
* unwind a failed injection and pin the degraded-icon and target-document paths ([a4dce5f](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/a4dce5f00c53a053319e94867d7de72f1a53cc6f))
* use Steam's own layout props, bound the lookup, and announce failures ([02ea10c](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/02ea10c778096c4b1d67275a2700fccd3e4d2854))
* validate SteamID64 by numeric range instead of digit prefix ([123856d](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/123856da538700b1c0962bf9f51f5ca62e3dfeb5))
* widen the icon canary and correct three inaccurate comments ([ae6183f](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/ae6183fbf1e15ab04404a10be88269303a3c0e8f))


### Features

* add icon, stylesheet, and disposer support for webkit injection ([8077b13](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/8077b135a37dc88ad8ef2508fe61ad88f2f62596))
* add settings store and vanity resolution to the backend ([d7186e6](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/d7186e6f0417913e2f54e3029008a1e3d1004d91))
* add shared URL, SteamID, and settings modules ([a5c21c3](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/a5c21c36f4b2a50aabfeaac583269ec50dcef72c))
* add store listing images ([124ba96](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/124ba967a464d513ad3f6657ad4abbd792f8b6c0))
* add the frontend icon component and settings binding ([a87c418](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/a87c4182c1f35a90277363ff9053017cf138c7ad))
* add the settings panel and player lookup ([269e874](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/269e874cc8fc14a2205c48a376cfc736fd9e1565))
* add vector CS2Tracker mark derived from the source raster ([b7abc5e](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/b7abc5eccc05baff6ced8edec44794eaadf0204d))
* badge friend rows with CS2Tracker links ([571d990](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/571d9905ade443671fc9cb8624db774a9d5090b7))
* inject the CS2Tracker button into Steam profile pages ([cfded11](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/cfded110a7a87455a62301c2b3079730c002eaf3))
* match the profile button to the CSStats.gg one beside it ([0849318](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/0849318004273ca57359eb0180d6cf70af15e81f)), closes [#1a1a1a](https://github.com/MuhammedResulBilkil/cs2tracker-extension/issues/1a1a1a) [#2d3748](https://github.com/MuhammedResulBilkil/cs2tracker-extension/issues/2d3748) [#2aa6ff](https://github.com/MuhammedResulBilkil/cs2tracker-extension/issues/2aa6ff)
* remove the in-client lookup and My profile buttons ([80f772a](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/80f772ad0f9d1c168bb52330e97239c52e87d5d2))
* report an unusable settings payload through a diagnostic hook ([54c499c](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/54c499c35f284c201456ddd6b5bee8341907b005))
* resolve the viewed profile's SteamID in the webkit bundle ([34cf873](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/34cf87351202d7e7927e46d9d0544063986f48d1))
* wire the webkit entry point to route guards and settings ([6571906](https://github.com/MuhammedResulBilkil/cs2tracker-extension/commit/65719065f8eaa638e9ad3430aa5027d4437c6368))
