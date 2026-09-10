-- #338 Commercial Promotion Wave 2 engineering carrier
-- Frozen by SELECT-only census on 2026-09-10. Deployment creates no enabled phase.
-- Exact cohort hash recipe: SHA-256 over bytewise code-sorted lines (COLLATE "C")
-- code|mapping_id|revision|source_payload_sha256|source_external_key.
-- Production unlock and promotion require separate explicit authorization.

begin;

do $deps$
begin
  if to_regclass('public.skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.v_ecoflow_ordermentum_listed_skus') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null then
    raise exception 'COMMERCIAL_WAVE2_DEPENDENCIES_MISSING';
  end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null
     or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'COMMERCIAL_WAVE2_EXTENSIONS_MISSING';
  end if;
end;
$deps$;

create table if not exists public.ecoflow_commercial_wave2_candidates (
  external_product_code text primary key,
  promotion_phase text not null check (promotion_phase in ('CANARY','EXPANSION')),
  enabled boolean not null default false,
  unleashed_mapping_id uuid not null,
  expected_mapping_revision bigint not null check (expected_mapping_revision>=0),
  expected_source_payload_sha256 text not null check (expected_source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  expected_source_external_key text not null,
  candidate_set_sha256 text not null check (candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  frozen_at timestamptz not null default now(),
  constraint ecoflow_commercial_wave2_code_normalized
    check (external_product_code=upper(btrim(external_product_code)))
);

insert into public.ecoflow_commercial_wave2_candidates(
  external_product_code,promotion_phase,enabled,unleashed_mapping_id,
  expected_mapping_revision,expected_source_payload_sha256,
  expected_source_external_key,candidate_set_sha256
) values
  ('140010','CANARY',false,'3001d0f1-6c1b-4b15-98a0-91443ca6b525'::uuid,0,'016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8','guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('140280','EXPANSION',false,'901c8d51-047c-4716-a4f4-a3e724891cfa'::uuid,0,'c3c4a95e6381fdd4f0efa18f404ccb7f15dae98ff879f4d10ac99a3acf1c350f','guid:22b88fa0-abfb-4512-bbe8-c07f3a02158e','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('140500','EXPANSION',false,'0db337ba-3e7e-4dd6-b502-17b7a6998a6c'::uuid,0,'e11eb5eb0087d0803ae857740c02f2d3f94603232c105f2f5ab653a3df75a7c6','guid:1cedc1f0-8f2b-4550-b112-0033b22fede0','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('140840','EXPANSION',false,'be60050d-0e23-40d4-8630-201c3604f4f4'::uuid,0,'8e76489040beed65fb7653818945b89df35db7232039dbc121151e81b642574b','guid:5e6c9587-2dd3-4978-827a-46e9c26c28b9','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('1WB','EXPANSION',false,'4db47f7c-a398-485c-9f97-eb73ab6621e0'::uuid,0,'4aa543a7459afd0ad73c3d186163dd15a345e24dc530c8727ab1edc7a07b945b','guid:22ce8757-2174-44ba-a9c4-251aa54f6e77','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('2SO','EXPANSION',false,'f0f7b7fa-42e7-44f8-b773-0852bfd32a7b'::uuid,0,'3dfcad1c8cc2e4660fc02e3befe28ecf510f7057b016e7823919a6cefb817e82','guid:ac35f4f6-17ac-4d18-9bd3-59244b06b14b','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('468417-XLBOX','EXPANSION',false,'001eb637-c669-44dc-8623-4fdaa4027fc5'::uuid,0,'72eccddb2578e9f339e0b11cd1e4dcd73621f75ca4a9b96cf9930ec91ae74b58','guid:426f0b0f-e00b-4789-99c1-60288d2c4f2b','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTL','EXPANSION',false,'41009543-4757-4f64-8361-99d4174aad57'::uuid,0,'886d241953bf80b3c327e30c6ff216dc68859d21296e2b65444d0f37ba38cd8d','guid:dffd35c1-6409-4cd8-830f-8d964969b145','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTLL-PLA','EXPANSION',false,'1fc09877-ce21-4df4-8116-d889c35cf980'::uuid,0,'16fec88da28cfe8b8ae53fec41aa7731f102ce043fad1d733103905a26e49905','guid:eaa3c9de-f112-4894-b230-ced8196936ab','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTLLONG','EXPANSION',false,'2051ec7b-e514-4153-bbdf-1fba17662678'::uuid,0,'c6124e9cc23f9ba3299e3b7eb235131a2ecc0f8a6ac173cd26f3e7fbbe48412f','guid:49d190e3-e4f2-427e-965c-d5b9ae27d601','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTLLONG-PLA','EXPANSION',false,'8b1989ac-448c-4805-bba7-86cd2dc2101b'::uuid,0,'2d3029e9a32678be368efad841839dbc77183d245b5febea61eabf8e08ab9627','guid:ca75fbed-5467-4125-b77a-191e331369a8','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTLM-PLA','EXPANSION',false,'ad35e44a-ec63-4ab3-954b-846ff88ebd36'::uuid,0,'42dc0eeacfc8e42f7938c6f0f5f506ada47797636138e55560eda05bb24618f9','guid:9cde6259-a4ed-45f2-a985-752842291422','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTLONG','EXPANSION',false,'dbd05464-476e-4da2-9825-9ec20e8b0361'::uuid,0,'a1bf56480553144929e3000b8f36c3b7660ff7a725e738f6c101b5a1c4142e75','guid:23318749-7be0-45d1-ae01-9d64569495ee','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTLS-PLA','EXPANSION',false,'14a8fde6-0d30-4f43-a2be-67ffe6bc327d'::uuid,0,'18b922206674b1860d69305ff863a801b2aab7b1aca06f4dd2f5d2131d0c53ae','guid:1d8b32dc-334b-453d-84ab-e8d8dc2da14b','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTM','EXPANSION',false,'a3dfa4ba-f77e-4c3c-8e79-7f20db944b87'::uuid,0,'de4d658207bd02e0b25df0a23c56730cb213c3faaf35ec5ccf9c999c8bfc432d','guid:55f25c54-6a5d-453d-950e-020a97fcfd4d','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('ASTS','EXPANSION',false,'c1b86e91-cd37-424b-afed-036e6196e435'::uuid,0,'236b67e88ecc23b8a3d39a49ec6a0e5bbecfaeb796211364fa1a6ec5b692f68f','guid:5e57ed69-35bf-4b3e-94b0-4185adc30bdf','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('AUD20','EXPANSION',false,'719630c4-22e9-4828-b7d6-d7f1e0ac686d'::uuid,0,'b953f6419e81863dc40dff66c18fc7bc0657c0875431f8b2dd2ddddd221590b0','guid:1c03e22a-1213-486e-9253-109ff566f1ea','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('B-SLB-630-W','EXPANSION',false,'10984532-0adb-47c8-bc96-38cfabf383a3'::uuid,0,'9b67cf9eb39ca17d7a1b4c182aa3b78a3ed609067803d3a129ecfb78d68d5914','guid:5e0167c1-a30e-4aef-a0a6-80cae2db0116','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('B-SLBL-PLA(D)','EXPANSION',false,'7099e38a-f194-4021-8592-0363e9e240c8'::uuid,0,'6566141784a2baa1cc09e209ecb5dd77cc300d30a5a526c6191438b590cca2c7','guid:a905a4ad-79f1-40e1-bdc3-6ceb1d98907c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BCB-F-L','EXPANSION',false,'ebcc7fd8-2913-4e53-ba90-c367ed99a640'::uuid,0,'74b4d8703bb0715e0280362337cf3a587f6896d151d4db2614d1f32e5cc17e2b','guid:f1318d59-b861-4446-a709-41c3f1f08eab','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BCB-F-M','EXPANSION',false,'8dddae52-4968-403d-b58c-7279b384e219'::uuid,0,'2d59d50ed45c4456ce1d21c21c37872a7834f69ad61540b33f2ae044fd9bdcf0','guid:bbf99896-947c-444d-a978-ee4c59e660ae','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BCPNB','EXPANSION',false,'53e038f5-1a72-44a1-94a4-63c7b61e8ef3'::uuid,0,'62d6c7249e1cc4b0fbbfce271e09185f7be8942024e2da1cb5f86d01ef02a39e','guid:99861b4f-09f0-49af-8b48-6e9c75890677','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BCTL50','EXPANSION',false,'bef6e66d-8ae9-43fa-8dac-fba58ffd5aa8'::uuid,0,'b4597fddf0512d5760dfcaff6f702d0a1765fbeb6127cf0729cee237edc14267','guid:0833f885-7131-47be-a6d4-0728894cac9f','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BFBK','EXPANSION',false,'b146815e-a8ba-48cf-8277-fe3e188f1971'::uuid,0,'21b290f6962c6ecf099a632fc612101f6ebf1ba7dee8367c48e29e68ab89988a','guid:03de5e17-b028-4fad-94ea-00199a1a4b06','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BL-120LB','EXPANSION',false,'3228d56e-58ad-43cc-b46c-d65191a026c9'::uuid,0,'b6f00e4cf99e4c54e3a615a3b5907b2541111c13a156f8192562503e281c2a8e','guid:96e162a2-7635-433b-90d6-bf863e6bccd1','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BP-SSD-TT','EXPANSION',false,'e92d26f0-f698-49b9-b3a8-5a81773dd3f6'::uuid,0,'3edfa69863f04b12c1703d2c9205b2be96a61edb33b07d322bbe3211a3218e41','guid:d5e0dace-96a3-401d-b899-fecd7b51d0e3','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BPB12','EXPANSION',false,'fdc8be1a-1eba-4ed6-b4f8-6835790eb221'::uuid,0,'bd20292086b85aa2ccfdd1e26f92ec3b0817d8cc786e1f27e73f57c349d7bd72','guid:c77e2b7e-a1a3-4573-acaa-21319b51b2d3','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BPB16','EXPANSION',false,'0fa7f3d7-1b3d-4d68-a36a-6db96181af3b'::uuid,0,'a617b2bd8b5a1ace9b7661f80ff558553bb18ac97199b22d410ef444588e289d','guid:73e8ec68-e211-4534-91bf-8381b160edb6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BPB24','EXPANSION',false,'482f18f9-fcd1-456a-baf7-e0c849bfccb2'::uuid,0,'7009e09a2a64a1abaf82e5d9c2ace7611d715a1208cbe3b5300e5bafb0431fe2','guid:3358f7c2-b4a6-4275-bf3f-fc5216a94d86','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BREWTIFUL12-90','EXPANSION',false,'1f23ff30-6b82-41b4-910d-bfb5744299d2'::uuid,0,'ca4c3f824f1803bcd623236f4614271319a31eec57998b43d0b7aaafa7d3e0b7','guid:129630ac-382f-496f-979e-ac1ede876d90','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BREWTIFUL8-90','EXPANSION',false,'a2a58d8a-8517-4de3-8504-6dfa1e9d6b9a'::uuid,0,'8562a5b19fa3bd28cd92663c2e6cddffa5891e96ea4492f83a9a217ebcc14b79','guid:b5592bc6-6e70-4e4a-bcfc-ddd908fe0740','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BSB16/25/32LPETBOX','EXPANSION',false,'a2465076-015d-4ad9-9985-1ceeb94f5410'::uuid,0,'633df5978075d4725968e5b9a8da151b733a4f71f7f2adba66676a0f10abc821','guid:2773b4ed-ee76-4fb4-8af1-3ace3ba2bced','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BSB42LPET','EXPANSION',false,'7b827311-c230-417e-8cba-6127f2f1858e'::uuid,0,'46d48ca69cb54a407d7317bc8455a22a9ff30d279f9b49183df4f7da872ec479','guid:424bbc28-9ddd-4073-a500-25f77657e8c4','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BSB42LPETBOX','EXPANSION',false,'f77f207e-ebe9-4d9f-aa8d-f4473a0d45fd'::uuid,0,'09541cfdcca5e3f6297299344fa59d73826c8e123e9bc76b27bde9924d400848','guid:ab9cdbe4-4938-4a6e-84d8-2f830ad724f2','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('BSB42LPLABOX','EXPANSION',false,'47e68408-753e-4ca9-b04b-c3c49c285765'::uuid,0,'cf840600eb70f54c2e25ec5e80637d245a4fb695dd9d734933b2af8caff7087b','guid:9c6188be-185e-480e-b24b-1c79a3324e19','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C-121','EXPANSION',false,'bb05d41c-53dc-412a-a931-b52498ab41e3'::uuid,0,'d102235cbb699f05e141f86e79ab76ef2bb38e17a58d9967c0f44c90fd49e99e','guid:bb4da473-3bd4-4a1c-ad6a-dc33312a7e62','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C-121-D','EXPANSION',false,'99e5769b-3ac4-4028-bd2b-fd364b24d23c'::uuid,0,'b04cfdf5a15edf7b0c10510c88d17b745b52f3f96153c1c593fa6363dc6f4d9c','guid:bb257358-69c7-4f89-9245-284d5f87a48a','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C-76F','EXPANSION',false,'f3b8b6df-2a8b-465e-b7e7-f5a74e99f14a'::uuid,0,'099ac657d93f531514da43d3b432020c48187a1e46ed2d0346795e670df6acaa','guid:72946411-9963-4895-837b-25ef5c7d8061','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C-96D(N)','EXPANSION',false,'c0bd95ef-889c-4ff7-b5fe-3969b7a1705f'::uuid,0,'58db57d1812179f8c9cbd758fedf83daa61967d3d7ac0617b9af1a5a9dc4af77','guid:28ed958b-a27c-4584-a61d-35282c159bd7','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C001','EXPANSION',false,'f76f638c-bec3-4a23-b724-e4e02a3c9642'::uuid,0,'f82261b39df68eb47857ba57bd006ebed886fd557f1188b3fd6d191634405655','guid:f936a0a9-63ce-4088-92b1-dc49b5771bd7','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C001/2SL','EXPANSION',false,'3430759f-39d7-4e8d-8541-868b9af2e10f'::uuid,0,'7eba8224c1a15e413970af6948890766cf843aaced8fcf7a16424bf896113380','guid:fe57269a-f78d-474b-a2ec-28d2714de5df','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C001/2SLBOX','EXPANSION',false,'f188a4d7-5bbc-4127-abf4-5582d117a1d8'::uuid,0,'e14cb511738a31b4a3d1e182671b591a190424a388c65e1d2868bdaff41de959','guid:8b23630f-bff5-4ff2-a8f9-0183f56ab1a1','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C001BOX','EXPANSION',false,'7ad1a506-cb8e-4e1e-938c-83d4ae41b6f8'::uuid,0,'1a5a847bf6b06fc05c76d17f7977065ebc0b7c098c9275686d945158402d1ba5','guid:94305655-ac1d-409c-9de9-a92f1314c633','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C002','EXPANSION',false,'bc4fb0c4-4692-4708-8879-7f7be0f6acd3'::uuid,0,'ed9f827463f7c8e76fe6b2fa26be8cfac76460f0f1bbf991c2115f1ee1844550','guid:3d9ee252-40ef-40d3-8c70-d7810d362227','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('C002BOX','EXPANSION',false,'af9f1db8-0c37-4622-bf80-cf65eeca017b'::uuid,0,'7c7bc337954de5fb4b23ad184ef2f3713faa6ea49ab9444e4800684fb6e26c4e','guid:00114570-7627-48c7-8400-8dd3a66819dd','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CC-01','EXPANSION',false,'9549b172-4103-4502-a38d-6ff3e6f94afd'::uuid,0,'447c130f476c321c66949cd98ae844bddc1354eebfda74ab61c79a28267398c5','guid:f33b1e6d-e35b-4f28-b46d-f4927ef56582','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCB187540','EXPANSION',false,'5f13e089-d77b-4579-9edf-d132c57e4435'::uuid,0,'455485c986e69a660a75921a342dd1b8de8c84d074704a38a985f4bf5a08791b','guid:4fb7b0d5-24e3-4fb1-b628-e8194b0a08b5','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCEK12-90','EXPANSION',false,'62164e84-2063-4841-ace3-ab15e65c22a7'::uuid,0,'aaaaa8d9c335f9aa13b3c4e7b4eb94d99fc2865f89e2d85886a944b6f94b0626','guid:b9c7ff2b-e353-4845-b182-0a1422e74b36','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCEK16-90','EXPANSION',false,'dcc0635b-26ff-4c4c-8675-180f2fa2625a'::uuid,0,'f6a2f00a5cbd3b80bfe8c30a5b3d70929f4e7fe301eac37455d649813be11755','guid:91a3c9de-1a6b-41f3-9e4c-f5bcc7cccce6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCLBPLA-62','EXPANSION',false,'08ab246a-0f8d-49a0-b04b-4b8ac92ec40b'::uuid,0,'bd3c7e8478a4073df043fd452c79a806e121ab3256a0653beb978185ebedda36','guid:7a600b10-d638-4f33-b27a-07a5a5afbe59','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCSA6-80','EXPANSION',false,'9f1ac6b0-0325-4799-92ab-61dd81208b79'::uuid,0,'ef2e7b1ecdeeb9c5ebbd217b697d25fada2f1301a78ec7ad4ac3ac8af87fb1cb','guid:250a6622-5ac6-45db-b954-d82d9c76ff3c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCSKBM6-80','EXPANSION',false,'29a9dc72-0081-4322-9f1e-1ccde1d0e74e'::uuid,0,'4f6e7035a4a5d2458f1ee610d84b65d6115f20925c1cdd0e90aba702c11cb6d2','guid:b5253c4a-07e2-400b-b4a5-547ef7b200df','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCSKBM8-80','EXPANSION',false,'2baeb5aa-58a7-4dc9-b10d-09a1d26fb380'::uuid,0,'69b4e71840f55c1c9c1f7f563e369d82d996c47500099ae17fe3dd2061a1748c','guid:11b9aee2-3f38-4592-9f30-ef8a5fac0adc','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCSPW4-62','EXPANSION',false,'a27e2bc8-51b7-44ed-9523-54c250e6f4d1'::uuid,0,'78e0bb0426046f06e6668c7b400cc7291237cfbbe22321df7480d2999be9f5e1','guid:74989a89-3855-4e34-a3c3-53430a1eb50c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCSW16-90','EXPANSION',false,'7f0243fb-d488-43fa-a5ad-b7f399327765'::uuid,0,'2472cb3a0066892ff09f9b92b0a6314267d8f08f066ed9f928f89864aa22a2f7','guid:adeda81f-2f5b-4a05-90ba-e10f3610941f','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CCSW4-62','EXPANSION',false,'a0941c9d-6c54-40e6-b788-5218ea5c2ab9'::uuid,0,'815902c5e82f6ff4e0dcdbfb5eb0ef1fba1057865fedec44e0f3d6aa3e231610','guid:aacdf705-89b5-41a2-a671-60a49614d7de','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDGPPF','EXPANSION',false,'1d67a824-3045-481e-92b7-d0e8abacf42a'::uuid,0,'457595ea9f3a265d83f79aac585494e7a2442baf1ef43a45d2a5e414e4c8b52f','guid:e85cd866-3ae2-42a6-8bc4-59fd9b44580a','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDGPPH','EXPANSION',false,'fc42197f-2c81-47e4-a677-19afdc086564'::uuid,0,'bbd3d929b6bfaf6b2a1330abad56469da0016714fda6e5d016442bcbf9a9db44','guid:c31f3a0d-67fd-4831-b27a-e93fcacfc6cc','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDGPPQ','EXPANSION',false,'5efff78b-46a2-4f63-b332-e5c52abc7e6d'::uuid,0,'70657ab8f5ec7d606534bf0f5ba611ec16ed2171dd6db59ec2f4e9136556f2db','guid:c1e41d9e-ea18-4147-b482-d75b8117f6a8','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDP-01','EXPANSION',false,'78289098-522b-4192-94b5-ecc0ed6ade2d'::uuid,0,'373e8dcf6232fa0ccc617cf9cccb38a63cd01dc2c7772bb3bf90e9aac58cb306','guid:cda46037-b45a-406d-bd19-4cf1991defa6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDPLA12-80','EXPANSION',false,'fc9649c1-4a22-4eb7-98cf-6a640bee916a'::uuid,0,'f28a2743116efa86bf66f8f2887da510adb0e5aac1f1a7115b45be1be002ef9a','guid:f1b3102e-e723-4e7a-9530-4686a0cb304c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDPLA12-90','EXPANSION',false,'b85702dc-dc60-4d9e-822b-65bdda98e64c'::uuid,0,'271230a0bab803331556a22153ab2789f1bde545f0ebe09bdb6834530f4f2a09','guid:9ea8b14b-2a13-4930-82ce-8d9cec803a71','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDPLA16-90','EXPANSION',false,'0a0daacb-f749-49d9-9b3e-e7f7bea5f5c1'::uuid,0,'472bdfe365aa2ba99322c12220f254dd4571b734129b71716bc91873c00787d7','guid:14e5705e-8577-43e3-a332-c26c1743e003','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDPLA6-80','EXPANSION',false,'2cbf2f6f-a2ee-4a3a-89b0-aac73783edaa'::uuid,0,'8a6708804dcd9cef21b97bbffd8acde731953814b59197551e413aec1b6b2983','guid:349b97d8-98e3-496a-92e7-a0c2bc4e9e99','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDPLA8-80','EXPANSION',false,'8ccf470c-4fa1-4e4d-bc4e-42c3702673a7'::uuid,0,'d69e7fa89b9dae3f7e35b47bc2cb495494f51475c7f7ff41e88a9593af813765','guid:dbbafa89-a80a-43a0-a3b4-48e98a60a0e2','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CDPLA8-90','EXPANSION',false,'ee5fe305-c184-4b57-945f-82e43e6fc6b3'::uuid,0,'f020906eed1e4336e7e953f45ad2f883f244dafbc147dbfc8c02d5de1e689255','guid:30e3a9bd-3127-49cb-9f51-d80b8f6c6942','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CFT-B084B','EXPANSION',false,'4e63cfa9-609c-43d4-a944-21bd826e6633'::uuid,0,'3d8703d976cb5ca6e99edcdbeafd07735a9461d7bc99397058c5c9181999d6e8','guid:2530633e-47cb-41b9-b3e5-24b9bddc0ad3','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CFT-B104','EXPANSION',false,'1d18e885-150d-486f-b0ce-6a7a27d0c7bf'::uuid,0,'7591907834b05f5a4b044ac3a086d0ed405f55c000661ce14d6d764f20cc7e00','guid:a320680e-38d4-4d77-a808-6765eb9cdd38','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CH8','EXPANSION',false,'1e0fc195-d0c6-4a95-aeb4-6bfd734a69d8'::uuid,0,'35f815ad3ed7e133424a41cc0bf038faf6414ff08aae81b95ff1e5f768d2a0fa','guid:5513bc8f-1707-414b-b35f-25a5912f12ed','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CP4535','EXPANSION',false,'1eb9ed89-1b15-45e9-87fc-21795fe51963'::uuid,0,'d06c2a125b7094eef3d8a9460f086882471385bf13a20311c616789a68f8258a','guid:ebd641fc-4894-496f-8be9-c18f7380def0','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CP5037','EXPANSION',false,'ade507b1-cde0-4a3d-8577-e435ba5de809'::uuid,0,'19fc33b3890ded8dca4644cb4d74631a197fd3f3a81107ab694625afbc48f0fa','guid:1f8bc862-e673-4211-a8e6-df9c534f8076','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CS08','EXPANSION',false,'42137316-a66c-4aad-b7ab-54f9514a1715'::uuid,0,'10a032627e2bf458a070f492a2b7a9eba3291909c40d8c391ba0c807ed8a4c9c','guid:3e2b57b6-140f-4fb8-a7db-c045862f1830','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CS10','EXPANSION',false,'e2d6a5b7-3585-4be9-9422-b0effbfec7d2'::uuid,0,'3919521e91fa3d2e05eb2d7a5051a68d54c91b679b78acdcd5ffcd78342034cb','guid:993aa2c7-fdb0-4709-9d0a-43c878d51cb1','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('CS12','EXPANSION',false,'37960862-317d-4c47-9905-dc8e0b06c67a'::uuid,0,'e7233925d6e8c56024bd5055ce90fcb7541d8bebbc211e1e266e1764f081bafc','guid:6bc926d1-0db0-4a8c-aaea-7581db4ddfed','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('E-SSNP-BR','EXPANSION',false,'73609ba3-8495-403c-b00c-ca3a0b65595e'::uuid,0,'303b3f78d32000f7bcf306bc4da3a352390c85ddbcffe49a487c3b2920a86f59','guid:79c58a84-24c6-4c59-91db-79907129e244','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('EF-DWLQ20','EXPANSION',false,'831865a5-8c28-4e91-b76d-8f1c420d82d9'::uuid,0,'78e61ef7558d03005eba461053c8643a33f0c6b14a1d2f2e5b066fc52e947b68','guid:2f2f743a-cdd3-476a-b50f-316d7fd49294','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('EF-RTUS05','EXPANSION',false,'74ff5395-9303-408b-b2aa-311ea9d399fe'::uuid,0,'18ee05f012b281c1a797c9289f4af04658d760e9062e4cebb8cf0ad2bfd20fd3','guid:0161e463-588a-4b64-84bd-a77aee6405ec','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('EFQ360','EXPANSION',false,'1e1bc3b1-73b0-4f64-8054-a6311e078d4f'::uuid,0,'901a5a6a0e01e630889608d163c71052c20c3ad472aef2dbc53ede46f65e8c8a','guid:f823cad1-33d9-4679-9e7a-4a81d6e89ba9','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('EFTROLL400','EXPANSION',false,'cdc2bf7c-9653-4690-97a6-482893d7817d'::uuid,0,'9ebe730d4eaacd0e5e1da91ba1eb2f011d21eaa72940d1ae46a45e4e0f6e3eb7','guid:2519f350-6c48-416e-b2fc-d13fbcee96b0','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('FC-01','EXPANSION',false,'63528611-bbdd-478a-91c3-912ac6a05364'::uuid,0,'671a1785a426ae6973bf627f1f04069545bf02e40bc873acd91bc447617e8796','guid:20e1a132-ff46-4c21-9cb6-7ebd73249bc3','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('FL115PLA','EXPANSION',false,'f367e220-dd65-4584-9e06-0c77c6dbedb4'::uuid,0,'bd35b90d646e74af71aed5cb8bdf4525c78944d997faec5981944b6ae371875b','guid:1f9037c1-b2a0-42ba-8533-3679ee6f8530','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('FORK160BULK','EXPANSION',false,'f92022c6-c24b-4c85-b7a0-571f23d00b00'::uuid,0,'7809bd07cb1b729193d634c90d7e17737dacfe0c30577b73d2861976fc192223','guid:18406a61-96b6-4603-8ceb-ff8cc205c661','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GP2(PACK)','EXPANSION',false,'5df4f977-7a17-42f5-a89c-310f794d3edc'::uuid,0,'b782660bbedb93470d14971fdca2982cf28f98a4332fc43e6b9ce7d457838517','guid:09fbb17e-0c78-40ce-8b85-6f013536fcf9','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GP4 (PACK)','EXPANSION',false,'8c590bc9-d9f0-4cc8-880e-472a276367f9'::uuid,0,'ac76f4bd228c8f83319716857724cda9bc6c8ca74e253ff63b7ab40f35585f86','guid:d97b63cf-7b97-4821-bec1-f117b1bb4c1d','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GP4W(PACK)','EXPANSION',false,'1a70d245-f1d3-41ab-8946-a209a4d5338b'::uuid,0,'fb4c9aa04d7d2c4536c75aa09af58ff8c632b1cba815a63a64c1a31cfa29604e','guid:44a156d8-aa0e-41d6-98ff-c2253441d919','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPF (PACK)','EXPANSION',false,'888a7a31-f0e5-46e9-988a-9939a09bd046'::uuid,0,'c4319cb5db74228baa232bbcf3e1e7ac034d2679ab6be57fcc28a67fe57a2963','guid:65ef7314-11e7-41d6-b9d7-86b4dd285baf','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPFW(PACK)','EXPANSION',false,'1a0d007a-77a6-4266-84b8-59bcf308a79d'::uuid,0,'0b890eb0c648040525d8dc7a695925d354ecca4f8af5637f17be4812d96275bc','guid:9ccd8441-453e-47e3-94bb-adb664033d90','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPL1L','EXPANSION',false,'b6c9aab6-bebf-4c80-8e6a-d26123076117'::uuid,0,'1930abf8faafd260a57d7be8279e295188712ccbd7d759aaab21bd3b43cbd8b9','guid:4db14ef3-1688-40b2-9c1f-ecbdc145b9d6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPL1LB','EXPANSION',false,'4ae243f8-f3d5-404b-8838-9dc69628d8d6'::uuid,0,'50d352d2140d6f227cf69586f767ee6ec3a497d330fd168dded1518a31fe4a4a','guid:5c3819ae-5225-425c-933c-bc52b3c3b179','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPL1S','EXPANSION',false,'8d4e67d0-2d31-43ce-b51c-3d6c1c2a5d3a'::uuid,0,'03ad1070d91e70f689f3a37be1db76d809eb53ae4130edeb9ea6b17ced45b116','guid:3443fe73-63d0-40c0-9e60-7f95f11172e7','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPL2L','EXPANSION',false,'420b7eac-7e84-4990-bb36-1ff14dc27175'::uuid,0,'4a04075b06cd1e3c1fca3605ee3d28d272afdd76cea5e8e76c398d17c355d38a','guid:1f8c5b3d-5453-4582-b507-fb33a76b6317','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPL2S','EXPANSION',false,'2cb425e0-c2ca-4d99-a98f-e3f76d3e50cd'::uuid,0,'01a0ca66cbde9b0e60e9b2e39166910588957d30aa6cf0ffe1dee26718e0fe24','guid:fa6ab4e6-c371-472d-87dd-d1befb4fc629','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPL3L','EXPANSION',false,'86707f57-4a9c-4d64-ae15-26ec1c85f9fc'::uuid,0,'f1d088fafa06885771890418587559339b6fcd04abe171f3666f0183d5b2aa60','guid:9512a678-4654-4dbf-9581-1d0dc354871e','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPL3LB','EXPANSION',false,'80be47e5-f6e3-4dba-8af7-76c58ab947b0'::uuid,0,'b2bf3c0c80efcce510849f1ed19a5c5d043fe8d68cf3adbffd890714937f6394','guid:b0e80946-461a-47bb-afac-53966effa3a9','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('GPNEWS','EXPANSION',false,'b5c3e9ba-e853-4042-b074-d269bad9576d'::uuid,0,'882f17ee219e81cede85b043e4b512f331baa9edcac6868b2129a2eb8fb06f78','guid:ed0d1e8f-d089-4c36-bcc7-e3adbba61b05','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('HUMMUSHUSTLE12-90','EXPANSION',false,'a475c874-27d4-4cdc-9eb7-7f9739b11ecf'::uuid,0,'9894247034fe5644036a6e7178ed9e2b078e457c21c37c5b481aa61df13398fe','guid:5b6b7c70-fbbd-463c-bb06-ecc3414d5144','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('HUMMUSHUSTLE6-80','EXPANSION',false,'a9e9246b-a6bd-4c5c-bc50-a49c2a72a2d8'::uuid,0,'0ec067e4d352efb2e4df5a79135d0fa0c30d4fbb040452f79f542a48d17b1ee0','guid:1573a15d-bcc5-407e-acee-9af4b9b6ffe2','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('HUMMUSHUSTLE8-90','EXPANSION',false,'c4b2141a-041b-4d4f-8ba7-b6c11616928f'::uuid,0,'73b4603ea41b63074bd06c9bfc2f0b9da3cec6315c2cbb4f10526899cb9dc1c9','guid:57328fcf-574d-4fa9-ae78-34c5b89e395f','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('JP-PBS-10X197-ART','EXPANSION',false,'ea852a97-cc96-4e3d-bfa8-e345fc306c41'::uuid,0,'22a51c01499978fcfead01a22309f5d923ac4740411acced7350166ef44c338a','guid:9b354a37-47cf-4aa0-860a-d6f86460eef6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KCTLL','EXPANSION',false,'c16f7081-fc4d-4bc8-b1e2-cd03ee59d1b6'::uuid,0,'d67b4654dbd011a51b31b95511ee89eedacb1f3540cccfe0f93c0704bcb8938e','guid:f0f896b0-727f-4977-b4b9-542631734caa','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KNIFE165BULK','EXPANSION',false,'aa3d32ce-b590-4d84-99c6-f0cb170b9108'::uuid,0,'7964f30e855dc02122d1fac9c2d0181bd1bc49ecccf261edd1af27ef6bcf3e84','guid:4b906073-8482-4bba-9eee-6db156e6f64a','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KOMCOFFEE12-80','EXPANSION',false,'56ae4961-7435-48fb-b7ec-144b5ea9fcb9'::uuid,0,'10ee3c6d7652fba7c1b8111bbaffececd324a7bc43d1597dc58873a4165f18b9','guid:8cc3f353-6843-402d-b156-36215d3954ed','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KOMCOFFEE16-90','EXPANSION',false,'bb348087-3923-45de-a2fe-feea26aa1bec'::uuid,0,'ea9005c396cc326faa22ab6c2e131805f7fd6886602147fd52906cb81a117e54','guid:b16daf21-0073-48ad-97a1-6e7b7857c9fc','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KOMCOFFEE8-80','EXPANSION',false,'68f7ef66-a6e1-4eba-a089-9c309119a0ad'::uuid,0,'8562c6871409275826d1bfad34a1fa6a91548b9ce65ea96f313fc465a67ec144','guid:5c73b618-d06b-4fba-8cda-8375f24b4adb','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KRC1000','EXPANSION',false,'a732a8ee-a2c2-4d90-98f5-fd0fb9556ddb'::uuid,0,'2c8889623f5e41cb486ee9794c23a2f49d7bf41e50d779eafce3535d1113b217','guid:5364cac5-50f1-4f09-8676-5b9f23170619','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KRC750','EXPANSION',false,'db65a699-880f-4963-a900-d38de085789d'::uuid,0,'5cd6eb40be699f67dabc7c1f59a5a4734981af2e5ce9b05e1f5b3b9b7b295853','guid:027c5dee-2c67-4942-9a51-0af9ac98692f','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KRCLPET','EXPANSION',false,'3cd1abfc-ba53-4178-89d9-6965481a1191'::uuid,0,'4ec435360e6d9124187a26bf0513050e15cb32ca8e113102ae322bbdd4d42d4e','guid:0ba00fc4-3d40-44d1-b3aa-63bec6a8cfe6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KRCLPLA','EXPANSION',false,'1b7413f7-717c-48e2-9686-7e2c5241eb47'::uuid,0,'d8bb3894cc995ec6fe64ad45eca1f910fa335529e8a560d1bd2cfb10754b966d','guid:cf6d3ad9-a292-4e25-bd47-665a36165b77','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KSB16BOX','EXPANSION',false,'b30a5279-375c-4c9a-9c86-ce17e2622454'::uuid,0,'01574886837db16e4ce91e17ae19bd35d42ddd7a7859bba30f1c50dfbc40c4ab','guid:f29efc48-34a1-4b85-986a-edb4c434e46c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KSB25BOX','EXPANSION',false,'dca10229-0c54-49b0-aa15-113429305c71'::uuid,0,'36a37b7e5065e50902b372d4d2b0ca0d25866a37ce60849038cf0d9e8137dac7','guid:adbe401f-6e63-41d8-b79f-8c3ed6509203','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KSB32BOX','EXPANSION',false,'c08a37b4-8dd7-45a6-8dc7-a9f5a6740acc'::uuid,0,'e0c174aced5919d965ede90c1c068674e26906b7f7487bb26c067dec2a6e8bfb','guid:05fd5851-c5f2-4764-a995-1742742d383f','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KSB42BOX','EXPANSION',false,'0ceb34b3-4d4a-41c9-acc6-5ed2e0b874b6'::uuid,0,'2b2ac9b212d1269eacd5c342af1436a10cb9d38bb4e3f49861af6b9789a0ca89','guid:4979396f-4836-466e-b69d-fe7ac32bb792','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KSC750','EXPANSION',false,'1c71e7cd-c03e-4d3f-be85-5ea9ac5c5541'::uuid,0,'bc7941a9792418d10c49dcaf6d882efe544f43ffa7ccc2f1981ae36eb55e959e','guid:8833e8e3-e374-41cb-be03-8840fe4a9054','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('KSCLPET','EXPANSION',false,'beeca9d7-d62e-447e-8505-78df3deb0f68'::uuid,0,'ff0f16632169ef0927e4fbd18948d25209045ddeace2c91459944a95cedca622','guid:f6ccda3e-61c4-4f9d-939b-d4d0e5e8eba5','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('LBW3','EXPANSION',false,'3018fb94-4723-4bb1-a6bc-fdca493acfdb'::uuid,0,'3f1cb81c6f1cb912ddeb85e85cded42757a1e4fdf175c0f1717aaa7bae0fb445','guid:5e9d3d9a-5123-46da-a3cc-af43df3513f9','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('P-360','EXPANSION',false,'297a7ed1-4e3e-441c-a740-ff700450d797'::uuid,0,'f0a4feeeac5117953bef79b6d6582f477f6b27a7365310f032ef090b591b1b68','guid:00b31b3a-8fa9-4193-829b-5cb510c8abfc','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('P-500','EXPANSION',false,'83f9ee0e-8ed8-4ee7-a982-2a6e3e0f2a12'::uuid,0,'0df772deef5246ab0b88eeb21cc8cef5f842a74611b2cff74ee10450a0000087','guid:6760ff28-4bc0-4b95-8fa3-4fe48ede800f','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('P-700','EXPANSION',false,'93247fc0-149e-472a-bbcf-ca5266458adc'::uuid,0,'01720c1804b69ea67c0ab81ea9fc5077596267215d9066a41fe74a11f1a13d76','guid:c3379812-f05f-4c07-8b85-697140e57cd5','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PBPB12','EXPANSION',false,'5707d9ee-d486-442b-abbc-121fcb56db1e'::uuid,0,'cc3400799f5f726f05542ec4684e5107c79d96f2174e6568e3bc3aaf203418d5','guid:2a524517-b951-40f7-a07d-ab632bdea268','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PBPB12/16/24L','EXPANSION',false,'d9ef618d-f4c8-44c8-8f31-5a803073f79f'::uuid,0,'4e741f580233204912117ebc5f032ad6a8166b5bbbd4505a5119fa692da63984','guid:c2ac6af7-c4e8-435e-82af-b937fb0d83b6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PBPB16','EXPANSION',false,'0a9fdbe4-3d30-4708-b4c7-612db21bbc30'::uuid,0,'97f218aa994179acbc10efa5ab20cbe08978b02489630391de00c395351a0648','guid:9d6c5a23-0896-4668-879c-bcd1a8878bfa','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PBPB24','EXPANSION',false,'b9e2acf4-39bd-4ab2-b8e8-7c6f06e870bd'::uuid,0,'e320ed3a60539c99aa116068a6cf2fedc43457793858d156f488d19d18570fa6','guid:c8b412c4-1f68-4850-9db8-36d57fe12cbe','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PBPB8','EXPANSION',false,'0525900b-988c-41e6-8723-3d88eb7786b7'::uuid,0,'62cb43a743e22a8690634cbad78e936e46a7d2fd9fa2effed8180053d4daa62c','guid:5b17bbb0-5e99-4dc7-b0b9-42c802ba81e5','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PBPB8L','EXPANSION',false,'3be17322-e003-4018-897d-8ed92423396d'::uuid,0,'de1ee35c8a08c1385db5e6768a83006f34efbac53dfd58b733ba1c68672d5713','guid:70098cad-e097-4d39-9555-9ab1fa328fa6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PCT3','EXPANSION',false,'dcc5eaac-03a8-4d6c-9621-3f62466bdeec'::uuid,0,'08e75f4d60f0955fd37a62325ffd5513f85d32c78c9ddacd6e0bac29c7ed6425','guid:9bf134c6-916f-4d85-8516-73a5df297b36','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PCT5','EXPANSION',false,'600f3948-8421-4651-bd5a-426417728e67'::uuid,0,'1aa9c98b0cc0c677ac93f91070c92345c9427341c4701e3cd2cb290c8ee2629f','guid:ca1feee1-9b3e-459b-83b2-18e09bb3d34a','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PROLL16W','EXPANSION',false,'da4ed979-8f85-4fc7-be40-59f906e2f914'::uuid,0,'67ab4960a27b5821d29751ec608a33a7c35db90d0a9e438cc9d9ac34caba5028','guid:d4fcd555-258e-420f-8c05-8d2e9c0c8a30','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PSJWHITE','EXPANSION',false,'97ef299b-6206-4827-87ad-4d8555db8bb5'::uuid,0,'94273885de4b57bae940b028d21e94efb9b4668de8510a2557bf994806eb2042','guid:e628d15b-338c-4381-95bd-2d585799169c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PSJWHITEBOX','EXPANSION',false,'b0e6831f-2669-4457-bc89-1820a45f0320'::uuid,0,'852f8c0449a0d8a98650e40c781b260eca10e4726e6117f70c54fd72069c6ebe','guid:8333cb6a-1410-4047-b778-30d68f8be0e1','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('PSRALLBLACK','EXPANSION',false,'fcf94584-12c5-4ea3-a1e7-79ff092d277c'::uuid,0,'89ea6a80f2921584742fbc6525b481acd6dbbcf1ad62599ad0e0f209d5ae017f','guid:57fff162-9f82-43a8-ab71-1a8d5288ab7c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('Q-250','EXPANSION',false,'9e7c29a9-bc5d-48ac-b35f-f763a6a2fc7a'::uuid,0,'eeeb3155d325692bfe9a7550de9586556adcfb3a3159789b0ed25a399e5bda5b','guid:0fd831eb-27eb-47c4-8e22-6fa589f197aa','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('Q006S0001','EXPANSION',false,'5b852923-e48a-4082-a83f-f59878888e94'::uuid,0,'bb5e597b73a29cda695894057c44e09af53c79a5f061e8e17ee6db84a50a9b4b','guid:ff41dbf2-3b28-486d-add7-57a39caee784','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('Q103S0001','EXPANSION',false,'e19fd629-aa51-4811-9a7a-071f96a6eaba'::uuid,0,'baf49fee89ca03dc0c33aa63cf1a1e97dcf3404301e43d7365c88b70b95e33fe','guid:8322117b-62d4-4fc1-8fbc-fc8b57247268','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-150Y','EXPANSION',false,'1bb5f28d-3b7a-4630-91e4-5ac0af259e65'::uuid,0,'ab48a63781fd4499127efdb7675d15fcff49456723efc52eebb581db81198d10','guid:9fb7c862-eb36-4fc5-bdff-08372134c2a4','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-200Y','EXPANSION',false,'377d4ca9-8f61-4dc3-aa15-36f94b02cb78'::uuid,0,'6283b565c606d77920c3a1c55e2c0f061ab9b9c4f99343c51fb7aba09cfc400d','guid:53f2ddaa-365e-48ef-8f62-57d45295fa7d','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-250','EXPANSION',false,'203416b3-fcea-4000-92f1-c74d9a7734d0'::uuid,0,'bc06c76b0cfaf317d8dd98e0e81cbc0d927648b4d9bb13a9de32d6d25d5c4b60','guid:beec0159-52aa-4293-bab2-656e41be7721','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-300Y','EXPANSION',false,'576ff106-2625-4cb6-9a36-f11e68c21944'::uuid,0,'0d05e78a813a6266f13ffafa16c3aca28caf76e96061a550118aee1881cd087f','guid:5957b8ec-4b29-4228-bab1-20915fe4d022','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-300Y-C','EXPANSION',false,'96334b43-242e-4c3f-84fb-96a00b27e541'::uuid,0,'19c31e41c6848dafdd6e326ad13590a4e80c3d862434a298bee3d52bf281fdab','guid:cb6c0585-3d00-4ca6-86bb-70c3a13cdc43','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-360Y-C','EXPANSION',false,'ddc4c1c5-d623-47d6-92d6-0c8e03791ebf'::uuid,0,'91c429ef759709cbaceafa1e42702c81112abcd5bb7bede53adec5300c41ef24','guid:449052ca-b26c-46f3-a7a8-3aa7cca11c82','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-420','EXPANSION',false,'8c0707c7-7d2f-414a-a203-50f030008c15'::uuid,0,'869a8eb3db2505cbdb11050809f197fe1322eb7d934bcb735eb92fff9b57d782','guid:af1da421-9e2e-4423-b9ed-52f419aba747','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-420-C','EXPANSION',false,'3e781851-ea5a-4136-b80c-b1950a47ee39'::uuid,0,'ee109bbd8c4eac70ceb2afd97f74478f85dd8a676d8c0b4a6634b9463be129ea','guid:cb71d1a9-2056-45de-a660-c2c16a601240','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-500Y','EXPANSION',false,'e5ab999c-27de-48f0-aa9a-b037f5d1aa74'::uuid,0,'8c139c60ccdba365572ea46a807baffe38b9e90904af37187ecb6e27e123ae50','guid:1779f214-146f-422a-a6c8-91ea19ebb50c','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('R-700Y','EXPANSION',false,'c9116a07-519e-433a-a270-661d7717441d'::uuid,0,'4af78525baf6a4ed1cb08ef4957361f5b2e2988fd72c07eb6ea92af85fb889c2','guid:2988a14c-8cd7-4b0f-a1ca-21ec2da1c5ac','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('REGROL5737','EXPANSION',false,'ffa05f7d-95c9-45c1-b8aa-e91bb2098033'::uuid,0,'f6930df90c06d97af038985191a2ede9e2859712b4d37725cc461203e3658c7f','guid:6d8f52d7-342f-4e78-86ca-7aa3bc9ceea6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('REGROL5757','EXPANSION',false,'b4c7dd50-d814-4f3b-af66-a54ddc8d617b'::uuid,0,'7475be7e75bb6e4d3394e0879cae72a8213b0fade77e7542a2c02240892d6b3e','guid:c7d6134a-65a1-4214-85e9-8a131b727130','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SB24BOX','EXPANSION',false,'4a8127e3-b3e7-4574-8ddd-7c4f768806b7'::uuid,0,'fba6b7c1e3b247dd896eba275017ff8061e3f3d414667e1ca3f8b0210b358bae','guid:56d84a1c-67b5-4bc4-b622-24235430ac16','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SB40BOX','EXPANSION',false,'0b07f3a5-b8f5-4929-a0dc-25af90d2dda1'::uuid,0,'c6473f8ef31223f111dce42fab707d37051df678d9868687c9899fe15e93a2bc','guid:a23d85ec-3044-43c7-bc8d-8725b711bdc6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SCCS8W','EXPANSION',false,'c4c1ca94-d2c7-466c-8e1f-7fcf4fb6ce9f'::uuid,0,'86251fefe8cfb2a665e9d7fcb3bb9b4eefa55db7fd499d6ad96f1dcfa656c866','guid:a30ae56b-1059-4ea9-a9b5-b765c6c69ce5','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SCCS96W','EXPANSION',false,'cc984ee7-381c-4e90-9654-cc6e93d47e19'::uuid,0,'3eca9c41107309128d567ec5e34f0bd4702e30cf023bfa19d890341002867eb3','guid:c013f084-12d7-4aa3-b28d-63b9307378b7','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SCCS9W','EXPANSION',false,'d179750f-d2fe-4d42-b303-b5696272dcc1'::uuid,0,'995a1c59c50460669abdc9d7ee334234c57a697c80c4c51c1d44f9f0a69f0591','guid:8e187a70-b4d0-47f7-ad5c-cea07f45fb19','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SCCSPW28BAG','EXPANSION',false,'12229d51-1992-4ed6-9db7-612f958fb388'::uuid,0,'020d347f9e0dbb4d6602a92317d906a597b0a34cf4ad1e27e0c0d392f11402cd','guid:992901ff-3a2e-49f8-b598-d0ce630a5dac','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SK1216','EXPANSION',false,'24356a80-5f58-4cd7-b550-b0e759b9d9d8'::uuid,0,'e1096440ac72d16e067d7b1094e36ca991b3ecfb0e887732aa34fd3d4153a247','guid:47543cec-7ca8-40e3-a0c2-f14d565bbafb','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SOSL#12','EXPANSION',false,'ed6dc13b-5341-441f-8b7a-09b81c40ef7b'::uuid,0,'f762ff439ccca008ab289f25124f7a4481bd8d599067386c528f234193aa97e5','guid:7ba69bea-1a71-4d62-b614-e13ca8ce604d','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SOSL#6','EXPANSION',false,'1d0fd21a-a19c-47bc-8edf-1661a3b1d8c0'::uuid,0,'e865fbb74fbdde6e2e24f18e340d2d41dc2a8bdaa9e1dbff0fe36289752b5bb2','guid:314a4a80-c5c7-4f17-af6e-4d38fadd45cd','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SOSL#8','EXPANSION',false,'9ff06f44-e2b8-42d6-a7f2-9067b6ae4af3'::uuid,0,'12925ddec8be89a8d23a43b3039d003e6d40402e172ea784f1b48cff01b222c2','guid:09968c74-a5c7-436d-b601-1365d8ee545b','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SPORK160BULK','EXPANSION',false,'989c046a-15b8-4ded-a249-81af1fe87e83'::uuid,0,'3dc65d8292730fa0709b026c2607b15da49b285fa4b0f02036d65e8d982f71ee','guid:e2557322-6f76-4f78-b637-986dd17e6613','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('SWL','EXPANSION',false,'5843cabc-4bdc-488e-aebf-d0524daba44d'::uuid,0,'086cb8a386682bec45b3ba6de28166ce76ffc4af78f74914339a7f270993493a','guid:047ef74c-27f7-4267-beb2-0102d0b24921','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('TEASPOON110BAG','EXPANSION',false,'e37543ca-7b99-4cf2-b42f-0e792162b6ec'::uuid,0,'57f733e1422cc35c0f054d474189a7bf10f986cb6d49713adf07f04b7ede7f6c','guid:0f02862e-7155-4851-91ae-11bf7c6630f6','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('V-FL131/231','EXPANSION',false,'29e79d5c-fe24-46b0-80fe-35de401fa513'::uuid,0,'dd6ec13d2ebd0c60616c41d5e3858b1095df9b51cedf822f31a58f9398cae727','guid:24f4bf7e-1a82-4272-a67c-e21aa700bd56','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('VFC231','EXPANSION',false,'e4ede7ad-5088-4c86-9e5f-6d86660c66d1'::uuid,0,'da11ed646cbedd02cf973d3d116a6dc9d5db9847646c5bc40e6176e2f71b5ebf','guid:17eaf1dc-3e46-4335-8947-cead1e764f25','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('WRC1000','EXPANSION',false,'dec2e994-8a06-4930-ab19-1b655ec7c2c2'::uuid,0,'0c59bccb94cc0fd945cf7b8ba11556ec89567bd12970a6950f92a4f9a26044ce','guid:a23d3725-b9c4-4098-917c-2a24caec6f64','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('WRC500','EXPANSION',false,'889f8562-c5e1-46a4-a03b-195bf584e4a8'::uuid,0,'b4153f482af474e22f5ef48c4f961e05c4a0cfd3f9e7a8f36fb0ad901bdd84c6','guid:1280e875-9615-4938-aaba-7895eaeba7f5','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('WRC650','EXPANSION',false,'c0402e0a-7b06-4971-b2f5-52d562f199b2'::uuid,0,'c4d06ae8bb9c61d22bd2c0228a25ef7445b2372a24e81ba468d4698020a5fd6d','guid:cbabd623-39da-4bca-9852-90c612b8f3d8','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  ('WRCL','EXPANSION',false,'261316e9-8a1b-4e5c-9282-0d7408fb498d'::uuid,0,'9d138eae491dee0a426f1ad4e8adb66e65bf5a13c95bf736422587bae8c0e5b4','guid:3c00cf88-8829-4206-809a-ef70bcf37f24','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a')
on conflict(external_product_code) do nothing;

do $frozen$
declare
  v_count bigint;
  v_canary bigint;
  v_hash text;
begin
  select count(*),count(*) filter(where promotion_phase='CANARY'),
         encode(extensions.digest(string_agg(
           concat_ws('|',external_product_code,unleashed_mapping_id::text,
             expected_mapping_revision::text,expected_source_payload_sha256,
             expected_source_external_key),
           chr(10) order by external_product_code collate "C"
         ),'sha256'),'hex')
  into v_count,v_canary,v_hash
  from public.ecoflow_commercial_wave2_candidates;
  if v_count<>164 or v_canary<>1 or v_hash<>'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a' then
    raise exception 'COMMERCIAL_WAVE2_FROZEN_SET_MISMATCH';
  end if;
  if (select external_product_code from public.ecoflow_commercial_wave2_candidates where promotion_phase='CANARY')<>'140010' then
    raise exception 'COMMERCIAL_WAVE2_CANARY_MISMATCH';
  end if;
  if exists(
    select 1 from public.ecoflow_commercial_wave2_candidates
    where external_product_code in ('CCSB6-80','CCSKBM16-90')
  ) then raise exception 'COMMERCIAL_WAVE2_HOLD_SET_ADMITTED'; end if;
end;
$frozen$;

create table if not exists public.ecoflow_commercial_wave2_phase_unlocks (
  promotion_phase text primary key check (promotion_phase in ('CANARY','EXPANSION')),
  candidate_set_sha256 text not null check (candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  unlocked_candidate_count bigint not null,
  canary_external_product_code text,
  canary_mapping_revision bigint,
  canary_source_payload_sha256 text,
  canary_commercial_sku_id uuid references public.skus(id) on delete restrict,
  authorization_command_id uuid not null unique,
  unlocked_by uuid not null,
  unlocked_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason))>=3),
  constraint ecoflow_commercial_wave2_unlock_shape check (
    (promotion_phase='CANARY' and unlocked_candidate_count=1
      and canary_external_product_code is null and canary_mapping_revision is null
      and canary_source_payload_sha256 is null and canary_commercial_sku_id is null)
    or
    (promotion_phase='EXPANSION' and unlocked_candidate_count=163
      and canary_external_product_code='140010' and canary_mapping_revision is not null
      and canary_source_payload_sha256 ~ '^[0-9a-f]{64}$'
      and canary_commercial_sku_id is not null)
  )
);

create table if not exists public.ecoflow_commercial_wave2_unlock_commands (
  command_id uuid primary key,
  actor_user_id uuid not null,
  promotion_phase text not null check (promotion_phase in ('CANARY','EXPANSION')),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create table if not exists public.ecoflow_commercial_wave2_promotions (
  external_product_code text primary key
    references public.ecoflow_commercial_wave2_candidates(external_product_code) on delete restrict,
  unleashed_mapping_id uuid not null,
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  commercial_sku_id uuid not null unique references public.skus(id) on delete restrict,
  external_mapping_id uuid not null unique references public.external_product_mappings(id) on delete restrict,
  authorization_command_id uuid not null unique,
  promoted_by uuid not null,
  promoted_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason))>=3)
);

create table if not exists public.ecoflow_commercial_wave2_promotion_commands (
  command_id uuid primary key,
  actor_user_id uuid not null,
  external_product_code text not null,
  unleashed_mapping_id uuid not null,
  expected_mapping_revision bigint not null check (expected_mapping_revision>=0),
  expected_source_payload_sha256 text not null check (expected_source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.ecoflow_commercial_wave2_candidates enable row level security;
alter table public.ecoflow_commercial_wave2_phase_unlocks enable row level security;
alter table public.ecoflow_commercial_wave2_unlock_commands enable row level security;
alter table public.ecoflow_commercial_wave2_promotions enable row level security;
alter table public.ecoflow_commercial_wave2_promotion_commands enable row level security;

revoke all on table public.ecoflow_commercial_wave2_candidates from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_commercial_wave2_phase_unlocks from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_commercial_wave2_unlock_commands from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_commercial_wave2_promotions from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_commercial_wave2_promotion_commands from public,anon,authenticated,service_role;

create or replace function public.ecoflow_unlock_commercial_wave2_canary(
  p_command_id uuid,p_requested_by uuid,p_expected_candidate_set_sha256 text,p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_role text; v_payload_hash text; v_existing public.ecoflow_commercial_wave2_unlock_commands%rowtype;
  v_eligible bigint; v_updated bigint; v_result jsonb;
begin
  select p.app_role into v_role from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then raise exception 'COMMERCIAL_WAVE2_FORBIDDEN'; end if;
  if p_command_id is null or p_requested_by is null
     or p_expected_candidate_set_sha256<>'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'COMMERCIAL_WAVE2_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ecoflow_commercial_wave2_unlock:CANARY',0));
  v_payload_hash:=encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,'phase','CANARY','candidateSetSha256',p_expected_candidate_set_sha256,
    'reason',btrim(p_reason))::text,'sha256'),'hex');
  select * into v_existing from public.ecoflow_commercial_wave2_unlock_commands where command_id=p_command_id;
  if found then
    if v_existing.command_payload_sha256<>v_payload_hash then raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH'; end if;
    return v_existing.result;
  end if;
  if exists(select 1 from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='CANARY') then
    raise exception 'COMMERCIAL_WAVE2_CANARY_ALREADY_UNLOCKED';
  end if;
  select count(*) into v_eligible
  from public.ecoflow_commercial_wave2_candidates a
  join public.ecoflow_unleashed_master_mappings m on m.id=a.unleashed_mapping_id
  join public.unleashed_raw_snapshots rs
    on rs.resource='products' and rs.external_key=a.expected_source_external_key
   and rs.payload_sha256=a.expected_source_payload_sha256
  where not a.enabled
    and a.candidate_set_sha256=p_expected_candidate_set_sha256
    and m.entity_type='PRODUCT' and m.mapping_status='UNMATCHED'
    and m.source_duplicate_count=1
    and upper(btrim(coalesce(m.source_external_code,'')))=a.external_product_code
    and m.source_external_key=a.expected_source_external_key
    and m.revision=a.expected_mapping_revision
    and m.source_payload_sha256=a.expected_source_payload_sha256
    and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=a.external_product_code
    and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
    and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')
    and (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
         where upper(btrim(coalesce(l.external_sku_code,'')))=a.external_product_code
           and l.is_visible_on_ordermentum)=1
    and not exists(select 1 from public.external_product_mappings e
      where e.provider='ORDERMENTUM' and upper(btrim(e.external_product_code))=a.external_product_code)
    and not exists(select 1 from public.skus s where upper(btrim(s.sku_code))=a.external_product_code);
  if v_eligible<>164 then raise exception 'COMMERCIAL_WAVE2_CANDIDATE_SET_DRIFT'; end if;
  if exists(select 1 from public.ecoflow_commercial_wave2_candidates where external_product_code in ('CCSB6-80','CCSKBM16-90'))
     or exists(select 1 from public.ecoflow_commercial_wave2_candidates where enabled) then
    raise exception 'COMMERCIAL_WAVE2_PHASE_SHAPE_INVALID';
  end if;
  update public.ecoflow_commercial_wave2_candidates set enabled=true
  where promotion_phase='CANARY' and not enabled;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'COMMERCIAL_WAVE2_CANARY_UNLOCK_COUNT_MISMATCH'; end if;
  v_result:=jsonb_build_object('promotionPhase','CANARY','unlockedCandidateCount',1,
    'candidateSetSha256',p_expected_candidate_set_sha256,'replayed',false);
  insert into public.ecoflow_commercial_wave2_phase_unlocks(
    promotion_phase,candidate_set_sha256,unlocked_candidate_count,authorization_command_id,unlocked_by,reason
  ) values ('CANARY',p_expected_candidate_set_sha256,1,p_command_id,p_requested_by,btrim(p_reason));
  insert into public.ecoflow_commercial_wave2_unlock_commands(
    command_id,actor_user_id,promotion_phase,command_payload_sha256,result
  ) values(p_command_id,p_requested_by,'CANARY',v_payload_hash,v_result);
  insert into public.app_security_audit_events(actor_user_id,actor_role,action,target_type,target_id,before_data,after_data)
  values(p_requested_by,v_role,'COMMERCIAL_WAVE2_CANARY_UNLOCKED',
    'ecoflow_commercial_wave2_phase_unlocks','CANARY',jsonb_build_object('enabled',0),v_result);
  return v_result;
end;
$$;

create or replace function public.ecoflow_promote_commercial_wave2_sku(
  p_command_id uuid,p_requested_by uuid,p_external_product_code text,p_unleashed_mapping_id uuid,
  p_expected_mapping_revision bigint,p_expected_source_payload_sha256 text,p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_role text; v_code text:=upper(btrim(coalesce(p_external_product_code,'')));
  v_candidate public.ecoflow_commercial_wave2_candidates%rowtype;
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_existing public.ecoflow_commercial_wave2_promotion_commands%rowtype;
  v_payload_hash text; v_name text; v_sku_id uuid; v_external_id uuid; v_result jsonb;
begin
  select p.app_role into v_role from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then raise exception 'COMMERCIAL_WAVE2_FORBIDDEN'; end if;
  if v_code in ('CCSB6-80','CCSKBM16-90') then raise exception 'COMMERCIAL_WAVE2_HOLD_BLOCKED'; end if;
  if p_command_id is null or p_requested_by is null or p_unleashed_mapping_id is null
     or p_expected_mapping_revision is null or p_expected_mapping_revision<0
     or p_expected_source_payload_sha256 !~ '^[0-9a-f]{64}$'
     or v_code='' or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'COMMERCIAL_WAVE2_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ecoflow_commercial_wave2_command:'||p_command_id::text,0));
  v_payload_hash:=encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,'externalProductCode',v_code,'unleashedMappingId',p_unleashed_mapping_id,
    'expectedMappingRevision',p_expected_mapping_revision,
    'expectedSourcePayloadSha256',p_expected_source_payload_sha256,'reason',btrim(p_reason)
  )::text,'sha256'),'hex');
  select * into v_existing from public.ecoflow_commercial_wave2_promotion_commands where command_id=p_command_id;
  if found then
    if v_existing.command_payload_sha256<>v_payload_hash then raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH'; end if;
    return v_existing.result;
  end if;
  select * into v_candidate from public.ecoflow_commercial_wave2_candidates
  where external_product_code=v_code;
  if not found then raise exception 'COMMERCIAL_WAVE2_NOT_ALLOWLISTED'; end if;
  if not v_candidate.enabled then raise exception 'COMMERCIAL_WAVE2_PHASE_LOCKED'; end if;
  if not exists(select 1 from public.ecoflow_commercial_wave2_phase_unlocks
    where promotion_phase=v_candidate.promotion_phase and candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a') then
    raise exception 'COMMERCIAL_WAVE2_PHASE_NOT_UNLOCKED';
  end if;
  if v_candidate.unleashed_mapping_id<>p_unleashed_mapping_id
     or v_candidate.expected_mapping_revision<>p_expected_mapping_revision
     or v_candidate.expected_source_payload_sha256<>p_expected_source_payload_sha256 then
    raise exception 'COMMERCIAL_WAVE2_FROZEN_EVIDENCE_MISMATCH';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ecoflow_commercial_wave2_code:'||v_code,0));
  if exists(select 1 from public.ecoflow_commercial_wave2_promotions where external_product_code=v_code) then
    raise exception 'COMMERCIAL_WAVE2_ALREADY_PROMOTED';
  end if;
  select * into v_mapping from public.ecoflow_unleashed_master_mappings
  where id=p_unleashed_mapping_id for update;
  if not found or v_mapping.entity_type<>'PRODUCT' or v_mapping.mapping_status<>'UNMATCHED'
     or v_mapping.source_duplicate_count<>1
     or upper(btrim(coalesce(v_mapping.source_external_code,'')))<>v_code
     or v_mapping.source_external_key<>v_candidate.expected_source_external_key then
    raise exception 'COMMERCIAL_WAVE2_SOURCE_NOT_ELIGIBLE';
  end if;
  if v_mapping.revision<>p_expected_mapping_revision then raise exception 'MAPPING_REVISION_CONFLICT'; end if;
  if v_mapping.source_payload_sha256<>p_expected_source_payload_sha256
     or not exists(select 1 from public.unleashed_raw_snapshots rs
       where rs.resource='products' and rs.external_key=v_candidate.expected_source_external_key
         and rs.payload_sha256=p_expected_source_payload_sha256
         and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=v_code
         and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
         and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')) then
    raise exception 'SOURCE_SNAPSHOT_CHANGED';
  end if;
  select max(l.listed_product_name) into v_name
  from public.v_ecoflow_ordermentum_listed_skus l
  where upper(btrim(coalesce(l.external_sku_code,'')))=v_code and l.is_visible_on_ordermentum;
  if (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
      where upper(btrim(coalesce(l.external_sku_code,'')))=v_code and l.is_visible_on_ordermentum)<>1 then
    raise exception 'ORDERMENTUM_COMMERCIAL_LISTING_AMBIGUOUS_OR_MISSING';
  end if;
  if exists(select 1 from public.external_product_mappings e where e.provider='ORDERMENTUM'
      and upper(btrim(e.external_product_code))=v_code) then raise exception 'COMMERCIAL_WAVE2_ALREADY_MAPPED'; end if;
  if exists(select 1 from public.skus s where upper(btrim(s.sku_code))=v_code) then
    raise exception 'COMMERCIAL_WAVE2_SKU_CODE_EXISTS';
  end if;
  insert into public.skus(sku_code,display_name,category,can_sell_by_carton,can_sell_by_sleeve,
    default_storage_unit,default_pick_unit,can_mix_pack,setup_status)
  values(v_code,coalesce(nullif(btrim(v_name),''),v_code),'Ordermentum commercial identity',
    false,false,'unconfigured','unconfigured',false,'mapping_draft') returning id into v_sku_id;
  insert into public.external_product_mappings(provider,external_product_code,internal_sku_id,
    default_unit_level,confidence,is_active)
  values('ORDERMENTUM',v_code,v_sku_id,'unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true)
  returning id into v_external_id;
  insert into public.ecoflow_commercial_wave2_promotions(
    external_product_code,unleashed_mapping_id,source_payload_sha256,commercial_sku_id,
    external_mapping_id,authorization_command_id,promoted_by,reason
  ) values(v_code,p_unleashed_mapping_id,p_expected_source_payload_sha256,v_sku_id,
    v_external_id,p_command_id,p_requested_by,btrim(p_reason));
  v_result:=jsonb_build_object('externalProductCode',v_code,'commercialSkuId',v_sku_id,
    'externalMappingId',v_external_id,'unleashedMappingId',p_unleashed_mapping_id,
    'sourcePayloadSha256',p_expected_source_payload_sha256,'promotionPhase',v_candidate.promotion_phase,
    'candidateSetSha256','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','setupStatus','mapping_draft',
    'physicalAuthorityCreated',false,'inventoryAuthorityCreated',false,'replayed',false);
  insert into public.ecoflow_commercial_wave2_promotion_commands(
    command_id,actor_user_id,external_product_code,unleashed_mapping_id,expected_mapping_revision,
    expected_source_payload_sha256,command_payload_sha256,result
  ) values(p_command_id,p_requested_by,v_code,p_unleashed_mapping_id,p_expected_mapping_revision,
    p_expected_source_payload_sha256,v_payload_hash,v_result);
  insert into public.app_security_audit_events(actor_user_id,actor_role,action,target_type,target_id,before_data,after_data)
  values(p_requested_by,v_role,'COMMERCIAL_WAVE2_SKU_PROMOTED','external_product_mappings',v_external_id::text,
    jsonb_build_object('mappingRevision',v_mapping.revision,'sourcePayloadSha256',v_mapping.source_payload_sha256),v_result);
  return v_result;
end;
$$;

create or replace function public.ecoflow_unlock_commercial_wave2_expansion(
  p_command_id uuid,p_requested_by uuid,p_expected_candidate_set_sha256 text,
  p_expected_canary_mapping_revision bigint,p_expected_canary_source_payload_sha256 text,p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_role text; v_payload_hash text; v_existing public.ecoflow_commercial_wave2_unlock_commands%rowtype;
  v_canary public.ecoflow_commercial_wave2_candidates%rowtype;
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_promotion public.ecoflow_commercial_wave2_promotions%rowtype;
  v_eligible bigint; v_updated bigint; v_result jsonb;
begin
  select p.app_role into v_role from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then raise exception 'COMMERCIAL_WAVE2_FORBIDDEN'; end if;
  if p_command_id is null or p_requested_by is null or p_expected_candidate_set_sha256<>'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or p_expected_canary_mapping_revision is null or p_expected_canary_mapping_revision<0
     or p_expected_canary_source_payload_sha256 !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'COMMERCIAL_WAVE2_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ecoflow_commercial_wave2_unlock:EXPANSION',0));
  v_payload_hash:=encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,'phase','EXPANSION','candidateSetSha256',p_expected_candidate_set_sha256,
    'expectedCanaryMappingRevision',p_expected_canary_mapping_revision,
    'expectedCanarySourcePayloadSha256',p_expected_canary_source_payload_sha256,
    'reason',btrim(p_reason))::text,'sha256'),'hex');
  select * into v_existing from public.ecoflow_commercial_wave2_unlock_commands where command_id=p_command_id;
  if found then
    if v_existing.command_payload_sha256<>v_payload_hash then raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH'; end if;
    return v_existing.result;
  end if;
  if not exists(select 1 from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='CANARY')
     or exists(select 1 from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION') then
    raise exception 'COMMERCIAL_WAVE2_EXPANSION_GATE_INVALID';
  end if;
  select * into v_canary from public.ecoflow_commercial_wave2_candidates where promotion_phase='CANARY';
  select * into v_promotion from public.ecoflow_commercial_wave2_promotions
    where external_product_code=v_canary.external_product_code;
  if not found then raise exception 'COMMERCIAL_WAVE2_CANARY_NOT_PROMOTED'; end if;
  select * into v_mapping from public.ecoflow_unleashed_master_mappings where id=v_canary.unleashed_mapping_id for update;
  if not found or v_mapping.mapping_status<>'MATCHED'
     or v_mapping.match_method<>'ORDERMENTUM_PRODUCT_CODE_EXACT'
     or v_mapping.canonical_object_type<>'COMMERCIAL_SKU'
     or v_mapping.canonical_object_id<>v_promotion.commercial_sku_id
     or upper(btrim(coalesce(v_mapping.canonical_code,'')))<>v_canary.external_product_code
     or v_mapping.candidate_count<>1
     or v_mapping.revision<>p_expected_canary_mapping_revision
     or v_mapping.source_payload_sha256<>p_expected_canary_source_payload_sha256
     or p_expected_canary_source_payload_sha256<>v_canary.expected_source_payload_sha256 then
    raise exception 'COMMERCIAL_WAVE2_CANARY_EXACT_MATCH_NOT_PROVEN';
  end if;
  select count(*) into v_eligible
  from public.ecoflow_commercial_wave2_candidates a
  join public.ecoflow_unleashed_master_mappings m on m.id=a.unleashed_mapping_id
  join public.unleashed_raw_snapshots rs
    on rs.resource='products' and rs.external_key=a.expected_source_external_key
   and rs.payload_sha256=a.expected_source_payload_sha256
  where a.promotion_phase='EXPANSION' and not a.enabled
    and m.entity_type='PRODUCT' and m.mapping_status='UNMATCHED' and m.source_duplicate_count=1
    and upper(btrim(coalesce(m.source_external_code,'')))=a.external_product_code
    and m.source_external_key=a.expected_source_external_key
    and m.revision=a.expected_mapping_revision and m.source_payload_sha256=a.expected_source_payload_sha256
    and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=a.external_product_code
    and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
    and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')
    and (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
      where upper(btrim(coalesce(l.external_sku_code,'')))=a.external_product_code
        and l.is_visible_on_ordermentum)=1
    and not exists(select 1 from public.external_product_mappings e
      where e.provider='ORDERMENTUM' and upper(btrim(e.external_product_code))=a.external_product_code)
    and not exists(select 1 from public.skus s where upper(btrim(s.sku_code))=a.external_product_code);
  if v_eligible<>163 then raise exception 'COMMERCIAL_WAVE2_EXPANSION_SET_DRIFT'; end if;
  update public.ecoflow_commercial_wave2_candidates set enabled=true
    where promotion_phase='EXPANSION' and not enabled;
  get diagnostics v_updated=row_count;
  if v_updated<>163 then raise exception 'COMMERCIAL_WAVE2_EXPANSION_UNLOCK_COUNT_MISMATCH'; end if;
  v_result:=jsonb_build_object('promotionPhase','EXPANSION','unlockedCandidateCount',163,
    'candidateSetSha256',p_expected_candidate_set_sha256,'canaryExternalProductCode',v_canary.external_product_code,
    'canaryMappingRevision',p_expected_canary_mapping_revision,'replayed',false);
  insert into public.ecoflow_commercial_wave2_phase_unlocks(
    promotion_phase,candidate_set_sha256,unlocked_candidate_count,canary_external_product_code,
    canary_mapping_revision,canary_source_payload_sha256,canary_commercial_sku_id,
    authorization_command_id,unlocked_by,reason
  ) values('EXPANSION',p_expected_candidate_set_sha256,163,v_canary.external_product_code,
    p_expected_canary_mapping_revision,p_expected_canary_source_payload_sha256,v_promotion.commercial_sku_id,
    p_command_id,p_requested_by,btrim(p_reason));
  insert into public.ecoflow_commercial_wave2_unlock_commands(
    command_id,actor_user_id,promotion_phase,command_payload_sha256,result
  ) values(p_command_id,p_requested_by,'EXPANSION',v_payload_hash,v_result);
  insert into public.app_security_audit_events(actor_user_id,actor_role,action,target_type,target_id,before_data,after_data)
  values(p_requested_by,v_role,'COMMERCIAL_WAVE2_EXPANSION_UNLOCKED',
    'ecoflow_commercial_wave2_phase_unlocks','EXPANSION',
    jsonb_build_object('canaryExternalProductCode',v_canary.external_product_code),v_result);
  return v_result;
end;
$$;

revoke all on function public.ecoflow_unlock_commercial_wave2_canary(uuid,uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)
  from public,anon,authenticated;
revoke all on function public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_unlock_commercial_wave2_canary(uuid,uuid,text,text) to service_role;
grant execute on function public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text) to service_role;
grant execute on function public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text) to service_role;

commit;
