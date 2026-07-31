# LiangPiao H5 API Reverse Engineering Notes

This document is the handoff point for `zhizhuodemao/js-reverse-mcp`.

Current implementation status:

- Local Spring config points `ticket.upstream.provider` to `liangpiao-h5`.
- `LiangPiaoH5Client` is wired as a conditional `TicketUpstreamClient`.
- Static H5 reverse engineering confirms the H5 app calls the same business API host:
  `http://business-api.liangpiao.net.cn`.
- `LiangPiaoH5Client` currently inherits the business API behavior from `PiaoDaRenClient`.
  This is intentional for now because the H5 bundle uses the same endpoint paths and `user-token` header.
- Backend observability endpoints:
  - `GET /api/upstream/piaodaren/status`
  - `GET /api/upstream/piaodaren/smoke`
  - `POST /api/upstream/piaodaren/login/configured`
  - `POST /api/upstream/piaodaren/login`
  - `GET /api/upstream/piaodaren/h5/probe`

Safe smoke check:

- `GET /api/upstream/piaodaren/smoke` checks local configuration, session token presence,
  H5 index reachability, and the read-only city-list API.
- It does not call OCR, quote, submit, pay, cancel, or any Xianyu fulfillment endpoint.

Captured H5 request wrapper:

- Base URL: `http://business-api.liangpiao.net.cn` unless request overrides `BASE_URL`.
- Default timeout: `20000`.
- Default `Content-Type`: `application/json`, or `application/x-www-form-urlencoded` when `paramsFormdata` is set.
- Auth header: `user-token: <TOKEN>`.
- Token storage key in H5 user store: `TOKEN`.
- On HTTP 401: H5 clears `TOKEN` and `userInfo`, then redirects to `/pages/login/index`.

Captured H5 login contract:

- Endpoint: `POST /login`.
- Body:
  - `userName`
  - `password`
  - `userTypeEnum`, normally `Consume`
- Success is checked with `state == 200`.
- Token is read from top-level `token` and user profile from `data`.

Captured H5/movie endpoints:

- `GET /film/cinema/getCityList`
- `POST /film/cinema/getDistrictList`
- `POST /film/cinema/getCinemaList`
- `GET /film/cinema/getFilmList`
- `GET /film/cinema/getShowList`
- `GET /film/cinema/getCinemaShowListByCinemaIdAndFilmId`
- `GET /film/cinema/getSeatListByShowIdForOrderV2`
- `GET /film/cinema/getCinemaShowListByCinemaId`
- `GET /film/cinema/getFilmListByCinemaId`
- `GET /film/cinema/getCinemaLine`
- `GET /film/cinema/getCinemaShowWithCinemaAndFilmList`
- `GET /film/cinema/getFilmSchedulingByFilmIdAndCityId`

Captured H5/OCR and order endpoints:

- `POST /film/identify/filmIdentify`
  - H5 sends form data.
  - Current backend sends `imgUrl=<urlencoded image url>`.
- `POST /film/order/officialQuotation`
  - H5 order-channel page uses this endpoint.
  - Current backend sends JSON with `showId`, `netPrice`, `seatCount`, `seatName`, `quotationChannels`.
- `POST /film/order/officialSubmitOrder`
  - H5 sends JSON.
  - Current backend sends JSON and reads only `data.orderNumber`.
  - The upstream order ID is read later from `data.orderInfo.id` in the order-detail response; it is never inferred from submit aliases.
- `POST /film/order/payOrder`
  - H5 sends form data.
  - Current backend sends `orderNumber=<urlencoded order number>`.
- `GET /film/order/getOrderDetail`
  - H5 sends form/query style params.
  - Current backend calls `?orderNumber=<urlencoded order number>`.
- `POST /film/order/cancelOrder`
  - H5 sends form data.
  - Current backend sends `orderId=<urlencoded order id>`.
- `POST /film/order/orderList`
- `POST /film/order/orderInter`
- `POST /film/order/orderPrompt`
- `GET /film/order/getOrderTicketCode`
- `POST /film/cinema/insertUserFeedback`

Still needs live verification:

- Exact response samples for OCR, official quotation, submit, pay, cancel, detail.
- Whether `officialQuotation` and submit payload fields differ by account/channel.
- Whether H5 has anti-bot/signature behavior outside the static request wrapper. Static bundle did not reveal a separate signature parameter.
- OSS upload is not in the H5 bundle; current backend still uploads screenshots to OSS before calling OCR.

Strict response policy used by the current client:

- Every business response must be a JSON object with an explicit `state` field.
- The only accepted success state is numeric `200` or the observed three-digit string `"200"`.
- Success data is read only after the state succeeds, and every endpoint validates its own required structure.
- Unknown states, missing fields, wrong field types, and malformed JSON fail immediately.
- The response shapes listed under “Still needs live verification” must be captured before authorizing production write operations; the client does not add aliases or compatibility paths while samples are missing.

Captured plugin-side Xianyu/Agiso endpoints:

- Agiso token is read from `localStorage.TOKEN` on `https://aldsidle.agiso.com/*`.
- Agiso proxy adds `Authorization: Bearer <AGISO_TOKEN>`.
- Agiso trade list: `POST https://aldsidle.agiso.com/api/Trade/List`.
- Agiso adjust price: `POST https://aldsidle.agiso.com/api/Trade/AdjustPrice`.
- Agiso dummy delivery: `POST https://aldsidle.agiso.com/api/ManualSend/SendDummy`.
- Xianyu direct adjust price: `mtop.taobao.idle.trade.user.adjust.price`.
- Xianyu direct dummy delivery: `mtop.taobao.idle.logistic.consign.dummy`.

Plugin execution policy:

- Price adjustment and dummy delivery use the explicitly selected Xianyu MTop contract only.
- MTop must return a top-level non-empty `ret` array whose first status segment is `SUCCESS`; nested or alternate status fields are not accepted.
- MTop failure, missing order fields, bridge timeout, malformed HTTP transport, or malformed backend envelope aborts the operation and remains observable.
- Agiso endpoints remain available for separately authorized/manual integration work, but the plugin does not automatically switch to Agiso after an MTop failure.
- Any mismatch between paid amount and quote amount is handled by the backend as `NEED_MANUAL`.
