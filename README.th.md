# X Collector

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/) [![Prisma + PostgreSQL](https://img.shields.io/badge/Prisma-PostgreSQL-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/docs/orm/overview/databases/postgresql) [![Hosted on Railway](https://img.shields.io/badge/hosting-Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.com/)

[English](README.md) · [日本語](README.ja.md) · ไทย · [中文](README.zh.md)

**นี่คืออะไร** X Collector คือบริการที่รวบรวมข่าวสารด้าน AI และเทคโนโลยีไว้เป็นหนังสือพิมพ์รายวันและฟีดที่ค้นหาได้

**ช่วยแก้ปัญหาอะไร** ข้อมูลที่มีประโยชน์กระจัดกระจายอยู่ตามโซเชียลมีเดีย เว็บไซต์เฉพาะทาง หน้าโปรเจกต์ซอฟต์แวร์ และฟีดที่ติดตาม ต่อให้เปิดเช็กหลายที่ซ้ำ ๆ ก็ยังอาจพลาดเรื่องสำคัญและความเชื่อมโยงของข่าว

**แก้ปัญหาอย่างไร** คุณเลือกแหล่งข้อมูลเอง แล้ว X Collector จะรวบรวม จัดหมวด และเชื่อมโยงข่าวที่เกี่ยวข้อง ก่อนส่งข้อมูลชุดเดียวกันให้ทั้งคนอ่านและ AI agent

![แผนภาพ X Collector ที่รวบรวมข้อมูลจากแหล่งข้อมูลแปดประเภท นำมาคัดกรองและจัดพิมพ์สำหรับคนและ AI agent พร้อมวงจรดูแลแหล่งข้อมูลที่มีมนุษย์เป็นผู้อนุมัติ](assets/hero.svg)

## สารบัญ

- [ความสามารถ](#features)
- [สภาพแวดล้อมที่รองรับ](#supported-environments)
- [สถาปัตยกรรม](#architecture)
- [เริ่มต้นใช้งาน](#quickstart)
- [การตั้งค่า](#configuration)
- [เอกสาร](#documentation)
- [สถานะการพัฒนาและแผนงาน](#development-status)
- [การมีส่วนร่วม](#contributing)
- [กิตติกรรมประกาศ](#acknowledgments)
- [สัญญาอนุญาต](#license)

<a id="features"></a>
## ความสามารถ

- **รวบรวมจากแพลตฟอร์ม 7 กลุ่ม รวมทั้งหมด 8 ประเภทแหล่งข้อมูล** รวม X (Twitter), Instagram, Facebook, Reddit, Qiita, GitHub และฟีด Alerts ซึ่งครอบคลุม RSS กับ YouTube ไว้ในที่เดียว
- **เปลี่ยนข้อมูลจำนวนมากให้เป็นฟีดที่อ่านรู้เรื่อง** ระบบปรับข้อมูลให้อยู่ในรูปแบบเดียวกัน จัดประเภทด้วยหมวดหลัก 11 หมวดและหมวดย่อย 15 หมวด เชื่อมข่าวซ้ำหรือข่าวต่อเนื่อง และสรุปเสียงจากผู้ใช้
- **จัดทำหนังสือพิมพ์รายวัน** งานจัดพิมพ์ตามกำหนดเวลาจะนำข่าวที่คัดเลือกแล้วมาจัดเป็นฉบับ Markdown จำนวน 13 หมวด
- **ให้คนและ AI ใช้ข้อมูลชุดเดียวกัน** ผู้อ่านใช้ผ่านหน้าหนังสือพิมพ์และเว็บ ส่วนระบบเชื่อมต่อใช้ Feed API ที่มีการยืนยันตัวตน หรือ MCP server แบบ Streamable HTTP ที่อ่านข้อมูลได้อย่างเดียว
- **เติมบริบทให้โพสต์สั้น ๆ** สามารถดึงเนื้อหาจากลิงก์และบทถอดเสียง YouTube มาเสริมก่อนจำแนก เพื่อให้มีข้อมูลประกอบมากขึ้น
- **ลดเวลาที่ต้องคอยหาแหล่งข้อมูลใหม่** ขั้นตอนค้นหาแหล่งข้อมูลจะดึงรายชื่อผู้สมัครจากโพสต์ X ที่เก็บไว้ ดึงข้อมูลโปรไฟล์ และให้ LLM ประเมิน แต่จะเพิ่มเข้าแหล่งเก็บข้อมูลจริงได้ต่อเมื่อมีคนอนุมัติเท่านั้น
- **ทำให้คุณภาพของแหล่งข้อมูลมองเห็นได้** ระบบคำนวณคะแนนความน่าเชื่อถือแบบอิงกฎทุกวันและนำไปใช้จัดอันดับในหนังสือพิมพ์ ส่วนรายการที่ความมั่นใจต่ำจะแสดงป้ายกำกับอย่างชัดเจน แทนที่จะถูกนับเป็นข้อมูลน่าเชื่อถือโดยไม่บอกกล่าว
- **พักแหล่งข้อมูลที่คุณภาพลดลงอย่างปลอดภัย** มีเพียงแหล่งข้อมูลที่ระบบค้นพบอัตโนมัติเท่านั้นที่อาจถูกปิด และต้องผ่านเกณฑ์สองสัปดาห์ติดต่อกัน แหล่งข้อมูลที่เพิ่มด้วยมือจะไม่ถูกปิดอัตโนมัติ
- **ดูแลแหล่งข้อมูลจากหน้าจอเดียว** หน้าตั้งค่ารวมรายการของแต่ละแพลตฟอร์ม การตรวจผู้สมัคร และการเปิดใช้แหล่งข้อมูลที่ถูกพักโดยวงจรคุณภาพอีกครั้ง

<a id="supported-environments"></a>
## สภาพแวดล้อมที่รองรับ

✅ หมายถึงตรวจสอบจาก repository นี้หรือจากระบบ production ที่มีบันทึกไว้แล้ว ส่วน ⚠️ หมายถึงมีระบุในเอกสารและคาดว่าจะทำงานได้ แต่ยังไม่ได้ทดลองเชื่อมต่อใน checkout นี้

| ส่วน | สภาพแวดล้อม | สถานะ |
|---|---|---|
| Runtime | Node.js 18.17.0 ขึ้นไป; checkout นี้ build ด้วย Node.js 26.5.0 | ✅ ตรวจสอบแล้ว |
| ฐานข้อมูล | PostgreSQL; เอกสารยังไม่ได้กำหนดเวอร์ชันเซิร์ฟเวอร์ขั้นต่ำ | ✅ ตรวจ Prisma provider และ migration แล้ว |
| Hosting | Railway | ✅ ตรวจสอบจาก production แล้ว |
| MCP client | Claude CLI, Claude.ai และ Claude Desktop | ⚠️ มีระบุในเอกสาร แต่ยังไม่ได้เชื่อมต่อจากสภาพแวดล้อมนี้ |

<a id="architecture"></a>
## สถาปัตยกรรม

**หลักการออกแบบ:** เก็บข้อมูลหนึ่งครั้ง กลั่นให้เป็นฐานข้อมูลร่วม แล้วเผยแพร่ในรูปแบบที่ทั้งคนและ AI agent นำไปใช้ได้

| โมดูล | หน้าที่ |
|---|---|
| `src/app/` | หน้า Next.js, หน้าจัดการ และ API endpoint |
| `src/collector/` | ตัวเก็บข้อมูลของแต่ละแพลตฟอร์มและจุดเริ่มต้นของงาน production |
| `src/lib/pipeline/` | การปรับรูปแบบ การจำแนก การเชื่อมข่าว การคัดเลือกโดยคำนึงถึงความน่าเชื่อถือ และการจัดพิมพ์ |
| `src/summary/` | สร้างสรุปรายวัน |
| `prisma/` | schema และ migration ของ PostgreSQL |

ดูขั้นตอนทั้งหมดได้ใน[เอกสารออกแบบ V2](docs/v2-design.md) ส่วนตารางเวลา deploy พฤติกรรมด้านความปลอดภัย การเก็บรักษาข้อมูล และคำสั่งดูแลระบบอยู่ใน[คู่มือปฏิบัติการ](docs/operations.md)

<a id="quickstart"></a>
## เริ่มต้นใช้งาน

### สิ่งที่ต้องมี

- Node.js 18.17.0 ขึ้นไป
- ฐานข้อมูล PostgreSQL
- ข้อมูลรับรอง Google OAuth สำหรับเข้าสู่หน้าจัดการ
- API key ของ ScrapeCreators และ OpenRouter เมื่อต้องการเริ่มเก็บและจำแนกข้อมูล

schema ปัจจุบันเก็บ embedding เป็น JSONB ใน PostgreSQL จึงไม่ต้องติดตั้งส่วนขยาย pgvector

### ติดตั้ง

```bash
git clone https://github.com/caty-ai/x-collector.git
cd x-collector
npm install
cp .env.example .env
```

### ตั้งค่าขั้นต่ำ

เปิดไฟล์ `.env` แล้วกำหนดค่าต่อไปนี้ก่อนเริ่มแอป

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/x_collector
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
NEXTAUTH_URL=http://localhost:3000
```

หากต้องการเก็บและจำแนกข้อมูล ให้กำหนดค่าเหล่านี้เพิ่มด้วย

```dotenv
SCRAPECREATORS_API_KEY=your_scrapecreators_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

### รัน

```bash
npm run migrate
npm run dev
```

เปิด `http://localhost:3000` แล้วเข้าสู่ระบบ จากนั้นเพิ่มรายการแหล่งข้อมูลตั้งต้นของคุณเองที่ `/settings` เมื่อเตรียม API key และแหล่งข้อมูลเรียบร้อยแล้ว ให้เปิด terminal อีกหน้าต่างเพื่อรันการเก็บข้อมูลด้วยตนเอง

```bash
npm run collect
```

<a id="configuration"></a>
## การตั้งค่า

| สิ่งที่ต้องการทำ | ดูที่ไหน |
|---|---|
| ดู environment variable ทั้งหมด | [รายการ environment variable](docs/operations.md#環境変数全リファレンス) |
| รันแต่ละขั้นตอนของ pipeline แยกกัน | [คำสั่งช่วยสำหรับ V2 pipeline](docs/operations.md#v2-パイプライン補助-cli) |
| ตั้งตารางเวลาบน production | [คู่มือ production cron](docs/operations.md#cron本番運用) |
| เพิ่มแหล่งข้อมูลของคุณเอง | [วิธีเพิ่มแหล่งข้อมูล](docs/operations.md#ソース追加方法) |
| ทำความเข้าใจการค้นหาแหล่งข้อมูล คะแนนความน่าเชื่อถือ และกฎวงจรคุณภาพ | [คู่มือปฏิบัติการ](docs/operations.md) |
| ดูประเด็นด้านปฏิบัติการที่ทราบแล้ว | [รายการติดตามที่ทราบแล้ว](docs/operations.md#既知の-follow-up未着手) |

<a id="documentation"></a>
## เอกสาร

| เอกสาร | เนื้อหา |
|---|---|
| [การออกแบบ pipeline](docs/v2-design.md) | ขั้นตอนประมวลผล ระบบหมวดหมู่ และโมเดลข้อมูล |
| [คู่มือปฏิบัติการ](docs/operations.md) | งาน production, cron, การตั้งค่า การเก็บรักษาข้อมูล และการดูแลแหล่งข้อมูล |
| [API reference](docs/api.md) | Feed API และ endpoint ของแอป |
| [คู่มือฟีดสำหรับ agent](docs/agent-feed.md) | การค้นหาและอ่านข้อมูลส่วนเพิ่มจาก agent |
| [คู่มือ MCP server](docs/mcp-server.md) | endpoint, การยืนยันตัวตน เครื่องมือ และการตั้งค่า client |
| [ประวัติการเปลี่ยนแปลง](docs/changelog.md) | การเปลี่ยนแปลงของโครงการ |

<a id="development-status"></a>
## สถานะการพัฒนาและแผนงาน

- [x] **การเก็บข้อมูล:** แพลตฟอร์ม 7 กลุ่ม การบันทึกแบบรวมใน PostgreSQL และ Feed API
- [x] **การกลั่นข้อมูล:** การปรับรูปแบบ การจำแนกด้วย LLM การเชื่อมข่าว การรวมเสียงผู้ใช้ และระบบหมวดหมู่ปัจจุบัน
- [x] **การจัดพิมพ์:** ฉบับ Markdown 13 หมวดพร้อมลิงก์แหล่งที่มา
- [x] **การเข้าถึงสำหรับ agent:** ฟีดที่ค้นหาได้และเครื่องมือ MCP แบบอ่านอย่างเดียว (`search_feed` และ `get_daily_news`)
- [x] **การควบคุมคุณภาพแหล่งข้อมูล:** การประเมินผู้สมัคร คะแนนความน่าเชื่อถือ หน้าจออนุมัติ และวงจรพักแหล่งข้อมูลที่มีมาตรการป้องกัน
- [x] **พื้นฐานสำหรับการเผยแพร่:** เอกสารสาธารณะหลายภาษา ไฟล์สุขภาพชุมชน และสัญญาอนุญาต MIT
- [ ] **แนวทางในอนาคต:** ปรับปรุง semantic topic clustering ทำขั้นตอนเผยแพร่ฉบับให้ชัดเจน และจัดทำเอกสารนโยบายเก็บรักษาข้อมูล

ดูการเปลี่ยนแปลงล่าสุดได้ใน[ประวัติการเปลี่ยนแปลง](docs/changelog.md) และดูช่องว่างด้านปฏิบัติการปัจจุบันได้ใน[รายการติดตามที่ทราบแล้ว](docs/operations.md#既知の-follow-up未着手)

<a id="contributing"></a>
## การมีส่วนร่วม

ขั้นตอนพัฒนาที่เริ่มจาก Issue ข้อตกลงการตั้ง branch และแนวทางเขียน Pull Request อยู่ใน [CONTRIBUTING.md](CONTRIBUTING.md)

<a id="acknowledgments"></a>
## กิตติกรรมประกาศ

X Collector ทำงานได้ด้วยบริการต่อไปนี้

- [ScrapeCreators](https://scrapecreators.com/) — API สำหรับเก็บข้อมูลจาก X, Instagram, Facebook และ Reddit
- [OpenRouter](https://openrouter.ai/) — การจำแนกด้วย LLM และการเรียบเรียงฉบับ
- [Qiita API v2](https://qiita.com/api/v2/docs) — การเก็บบทความจาก Qiita
- [GitHub REST API](https://docs.github.com/en/rest) — ข้อมูล repository และการค้นหา
- [Railway](https://railway.com/) — hosting และงานตามกำหนดเวลา
- [TranscriptAPI](https://transcriptapi.com/) — เสริมบทถอดเสียงจาก YouTube

<a id="license"></a>
## สัญญาอนุญาต

X Collector เผยแพร่ภายใต้ [MIT License](LICENSE)
