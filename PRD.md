## update-kit PRD

### 1) 한 줄 요약

**CLI 앱이 “어떻게 설치되었는지(채널)”를 감지**하고, **가장 안전한 방식으로 업데이트를 안내/실행**하며, 필요 시 **자동 업데이트(네이티브 설치)**까지 지원하는 업데이트 프레임워크.

---

### 2) 배경 / 문제 정의

#### 2.1 CLI 업데이트가 어려운 이유

* CLI는 설치 채널이 다양함: **npm**, **Homebrew**, **직접 다운로드(압축파일/바이너리)**, 사내 배포, curl|sh 등.
* “업데이트”는 설치 채널이 책임져야 하는 경우가 많음(특히 패키지 매니저).
  → CLI가 임의로 in-place 교체하면 **권한/소유권/정합성** 문제가 생김.
* 잘못된 업그레이드 안내는 UX 신뢰를 깨뜨림(예: brew로 설치했는데 brew index가 stale이라 업그레이드가 “최신”이라고 나오는 문제). ([GitHub][2])

#### 2.2 레퍼런스: codex의 체크 전략(성능/UX)

* codex는 **시작 시 네트워크 호출로 UI를 막지 않기 위해**, “이 실행에서는 캐시값을 읽고”, **백그라운드에서 최신 버전을 갱신**해서 다음 실행에 배너를 띄우는 패턴을 사용함. ([GitHub][1])
* codex는 설치 방법으로 **npm / brew cask / GitHub Release 바이너리**를 공식적으로 안내함. ([GitHub][3])

---

### 3) 목표(Goals)

1. **설치 채널 감지**

   * native install / unmanaged(직접 다운로드) / npm / brew(+추가 채널 확장 가능)
2. **업데이트 체크(Checker)**

   * 최신 버전 조회 + 캐시 + rate-limit/오프라인 대응
   * *startup non-blocking* 기본값(= UI/명령 실행을 막지 않음)
3. **업데이트 실행(Updater)**

   * **native install**: in-place 자동 업데이트(다운로드 → 검증 → 원자적 교체)
   * **npm/brew**: “패키지 매니저 커맨드 실행” 옵션 제공 + **CLI 종료/재실행 유도**
4. **UX 레이어 제공**

   * TUI/CLI/daemon-less 환경에서 공통으로 쓸 수 있는 배너/프롬프트/에러 메시지 템플릿 + 훅(hook)
5. **바인딩/런타임 확장성**

   * Rust/Node/Bun 등에서 널리 쓸 수 있게 **코어 설계 + 언어별 바인딩 전략** 제공

---

### 4) 비목표(Non-goals)

* OS 백그라운드 업데이트 데몬(항상 상주) 제공
* 시스템 패키지 매니저 대체(= brew/npm 자체 로직을 재구현)
* 관리자 권한 상승(sudo) 자동 수행(기본 정책상 금지)

---

### 5) 주요 사용자 시나리오(User Stories)

1. **(TUI)** 사용자가 CLI를 켰더니 “업데이트 있음” 배너가 뜬다.
2. 사용자가 **Update**를 선택하면:

   * native install이면: 다운로드/검증/교체 후 “재시작” 또는 “현재 세션 유지 리로드” 선택
   * npm/brew면: CLI가 `npm i -g ...` 또는 `brew update && brew upgrade --cask ...`를 실행하고, **종료 후 재실행을 유도**
     (brew는 “update 선행”이 UX상 중요하다는 피드백이 실제로 누적됨) ([GitHub][2])
3. 사용자가 “자동 업데이트가 싫다” → 체크/배너/실행을 끌 수 있다.
4. 사내/고정버전 운영(Managed by IT) → 체크는 하되 실행은 금지(또는 배너 완전 비활성).

---

### 6) 핵심 정책: “왜 in-place self-update는 unmanaged에서만 강제하는 게 가장 안전한가”

**정책(P0): in-place 교체는 ‘내가 설치한 파일을 내가 관리하는 경우’에만 강제.**

* **패키지 매니저 설치(brew/npm)**에서 in-place 교체를 하면:

  * 패키지 DB와 실제 파일 상태가 어긋남 (다음 업데이트/언인스톨/검증이 깨짐)
  * 권한/소유권/경로가 읽기 전용일 수 있음(MDM, corporate macOS 등)
  * “업데이트 했는데 최신이 아님” 같은 혼란이 커짐(실제로 brew에서 stale index로 자주 발생) ([GitHub][2])
* 반대로 **unmanaged**(GitHub 릴리즈 바이너리 다운로드 등)에서는:

  * 패키지 DB가 없고, 결국 사용자가 “그 파일”을 직접 쓰므로
  * **안전한 원자적 교체(다운로드→검증→rename swap)**가 가장 단순하고 예측 가능

즉, update-kit은 **채널 기반 정책 엔진**을 기본으로 가진다.

---

### 7) 제품 요구사항(PRD Requirements)

#### 7.1 설치 채널 감지(Install Channel Detection)

* **필수 채널**

  * `native` : update-kit이 제공한 installer/receipt로 “관리형 네이티브 설치”임을 증명
  * `unmanaged` : 압축 해제 바이너리/단일 파일 실행(패키지 매니저 흔적 없음)
  * `npm-global` : 전역 설치
  * `brew-cask` : brew cask 설치
* **감지 방식**

  * (권장) **증명 기반**: native는 receipt 파일/설치 메타로 확정
  * (보조) 휴리스틱: 실행 경로, 심링크, 알려진 prefix, `brew list --cask <id>`, `npm prefix -g` 등
* **출력**

  * `{ channel, confidence, evidence[] }`
  * “애매하면 실행하지 않고 안내만”이 기본 안전 정책

#### 7.2 업데이트 체크(Version Check)

* **소스**

  * GitHub Releases / custom manifest endpoint(선택)
* **캐시**

  * `latest_version`, `last_checked_at`, `source`, `etag/if-modified-since`(가능하면)
* **non-blocking 기본값**

  * codex처럼 “이번 실행은 캐시로 판단 + 백그라운드 갱신” ([GitHub][1])
* **체크 주기 정책**

  * 기본: 20h 또는 1일 1회(로컬 데이 기준 옵션)
  * 수동 오버라이드: `--check-update`, `--no-update-check`

> 참고: codex는 `last_checked_at`과 비교해 “20시간이 지났으면 백그라운드 갱신”을 수행하고, 최신 릴리즈 태그를 받아 캐시에 저장하는 로직이 제안/논의된 바 있음. ([GitHub][1])

#### 7.3 업데이트 실행(Update Apply)

**(A) native install: 자동 업데이트**

* 스텝

  1. 최신 버전/아티팩트 URL 결정
  2. 다운로드
  3. **무결성 검증**(필수): checksum 또는 서명 검증
  4. 원자적 교체: `tmp → rename swap` (실패 시 롤백)
  5. post-action: `reexec` 또는 “재시작 안내”
* 제약

  * 실행 중 파일 lock이 강한 OS(특히 Windows) 대응: “새 파일로 next-run 교체” 전략 제공

**(B) npm/brew: 커맨드 실행 + 종료/재실행 유도**

* update-kit이 제공할 수 있는 모드 2개:

  1. **“명령 안내” 모드**: 커맨드 문자열만 출력(가장 안전)
  2. **“명령 실행” 모드**: 사용자가 명시적으로 동의하면 update-kit이 직접 실행
* 실행 시 요구사항

  * stdout/stderr 스트리밍
  * 종료코드/실패 메시지 정규화
  * 성공 시: **현재 프로세스 종료 + 재실행 안내**
* brew는 특히:

  * stale 인덱스 문제가 반복되므로 `brew update && brew upgrade --cask <id>` 형태를 기본 권장으로 설계(또는 적어도 “brew update 선행”을 옵션/권장으로 포함) ([GitHub][2])

#### 7.4 “native install 유도(리디렉션)” 기능

* unmanaged로 실행 중인데, 프로젝트가 native 업데이트 정책을 원한다면:

  * “지금 설치 방식에서는 자동 업데이트가 제한됩니다”
  * `update-kit install` 또는 설치 안내로 유도
* 목적: “다운로드 실행 → 네이티브 설치로 전환”을 제품 레벨에서 지원

#### 7.5 보안/정책(Security & Policy)

* 네트워크:

  * TLS 기본, ETag/캐시 활용
* 아티팩트 검증(강제)

  * checksum(최소) + 서명(권장)
* 권한:

  * sudo 자동 호출 금지(기본)
* 실행 커맨드:

  * “자동 실행”은 opt-in
  * 감지 confidence 낮으면 “안내만”

---

### 8) API 설계(초안)

#### 8.1 Core 모델

* `UpdateKit(config)`
* `detect_install() -> InstallDetection`
* `check_update(mode) -> UpdateStatus`

  * mode: `non_blocking` | `blocking`
* `plan_update(status, detection) -> UpdatePlan`
* `apply_update(plan, options) -> ApplyResult`

#### 8.2 UpdatePlan 예시

* `plan.kind`:

  * `NativeInPlace`
  * `DelegateCommand` (npm/brew/기타)
  * `ManualInstall` (감지 실패 or 권한 문제)
* `plan.post_action`:

  * `SuggestRestart`(기본)
  * `ExitAfterApply`
  * `Reexec`(native에서만 기본 허용)

---

### 9) UX 요구사항

* 메시지 템플릿은 “라이브러리 기본 제공 + 앱이 override 가능”
* 출력 채널:

  * plain CLI
  * TUI 배너(프레임워크 agnostic)
* 실패/경고 UX:

  * brew/npm 감지 불확실 → “명령 안내 모드”로 다운그레이드
  * 오프라인/프록시 → 캐시 기반으로만 판단 + “다음에 다시 시도” 안내
