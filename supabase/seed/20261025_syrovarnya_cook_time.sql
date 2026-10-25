-- Время готовки блюд тестового ресторана «Сыроварня» (cook_time_min, минуты).
-- Ориентировочные значения для демонстрации: от них зависят таймеры в заказе официанта,
-- подсказки «блюдо задерживается» и фраза «~N мин готовка» в голосовом помощнике.
-- Заполняет только пустые значения (cook_time_min IS NULL), заполненное не трогает.
-- Запуск:  sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/seed/20261025_syrovarnya_cook_time.sql
-- Откат:   UPDATE public.menu_items SET cook_time_min = NULL WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee';

BEGIN;

UPDATE public.menu_items SET cook_time_min = 1
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '0a24de42-ce7a-4dcd-b62f-967a268e4bb6',
  '1989da1d-acd5-42ac-b5dd-7daf58c65e0c',
  '1dd851ca-db3c-449e-bad1-2b3adf7ee607',
  '2c1c4e2e-bc39-4ae1-b6d6-f551a2681ddc',
  '2d4e84f5-f0d9-4959-9bda-64411ef9fc37',
  '3b76f06e-5149-4c3f-b951-676481c09535',
  '4d9f10f5-d453-417a-8112-30269f47cbbb',
  '6b4e68be-c68d-4b07-99da-a3760b77ec3d',
  '7ca8bf9b-b350-4fd7-b85a-a402384e923f',
  '7d3d65ae-c2cc-4564-a435-fffb59565e27',
  '8dd87c0f-9918-4297-89ff-c39f1849c4f5',
  '94e00295-5e9f-40ce-897e-43cfebca32bf',
  'a554211a-0470-45cc-a6cf-28521dcda25c',
  'a6e33764-4b7e-49ba-8a9a-1158ef759780',
  'aadc8585-70eb-4a06-b0c7-eddaad8519e0',
  'ab8c59e3-9ba6-405e-94b3-f114b30aea1c',
  'b5bd4835-911f-4305-8565-839ee450c43d',
  'b86786da-e5fa-4243-adbe-92f5390a75d0',
  'bcf2874c-70c5-46aa-9478-8b703507202c',
  'be40e207-91c6-4dd6-bca9-9d9900f84572',
  'c35b06e1-fadf-4451-9726-dc309dccf3ed',
  'c8078bdc-3755-4d3c-a795-660e4ce99105',
  'd8047fd8-23d8-4b5d-8358-4adf74cec052',
  'db570699-e6cf-4261-bd07-611ede0b47ff',
  'e1198b83-9ebf-4404-93a5-8f8a853d4c44',
  'f72c3b9a-e1c1-4951-8e23-4f0770cde037');

UPDATE public.menu_items SET cook_time_min = 2
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '0258b352-f5c5-46d2-83a0-7b39c6649f5b',
  '12af856a-d7c4-48a0-b3e3-d4ec63307091',
  '255c38d7-3460-4196-aa98-62d7981d536c',
  '2742c204-c505-4b86-aac7-c90554ba2593',
  '2e773ec2-564f-4ece-857f-207dcce671f0',
  '2ed542dd-8d6c-4b35-adce-01b52f89c293',
  '3818cd61-52e3-46d0-875c-28912206e71f',
  '3d196329-44f8-4542-8c13-ecd42422eecb',
  '411321bb-5449-43a6-9389-ba736b16c76e',
  '635d55a4-fa57-4f99-a050-5530327a8abf',
  '68524c8d-98e2-443b-ae27-f4744a10bbcf',
  '6ef27599-b926-4a55-9b3f-da2950688210',
  '76b3cdda-4af8-4836-9ebb-a388d94cef38',
  '7c3de4cd-abbb-450d-8e34-3c4672807df4',
  '8fe9b3d9-3e4e-47cc-b480-a63bd0831c67',
  '99262423-b307-4eec-9000-9036cf40a71a',
  'a4309092-d678-4c05-b3af-9e692b7b533b',
  'a55db173-3fa7-4dfc-af6b-9d0a0b5886f5',
  'a87ad0bd-8d4e-4815-82d3-08f889debc9e',
  'af847459-30c1-4ecd-a6c3-c034fe8033aa',
  'b35bd602-2b9d-4018-918e-4d7ce1a17841',
  'baace01b-5ea8-4586-ae64-3ed5f6f51050',
  'bf54bc4e-e015-4225-9229-46418f9fa50c',
  'c6045e41-3a2b-4b96-b2f9-cf0ffcf5ac75',
  'd8997b95-75cb-4a35-b87b-6e9b6d0cada9',
  'dac7f574-edfe-4316-a27f-a806de5bcef6',
  'dca21512-e5d6-4dd5-b925-51a6be1ae415',
  'deea5d3d-ad81-49f5-b10d-700dff9cd3e4',
  'eb664abc-0e79-4026-b149-ba1153c560f7',
  'ef9fbd44-5c75-47c2-9b73-76647cd2b5e8',
  'efdab69e-6aab-4521-82ae-514bc17fdd0e',
  'f588c363-12d3-4e6c-9137-9a9eb2818feb',
  'f9e38bc8-97ab-4c7e-b624-17776e83da78');

UPDATE public.menu_items SET cook_time_min = 3
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '115d98ce-5267-473b-a850-d96a8cbe6872',
  '19054c6a-7e19-4f46-8de1-f501bf11479a',
  '215ec445-8a4b-4c54-8837-87f9a534aeb1',
  '2df74f5d-c84a-416b-9b8f-24942b3a3bb6',
  '52cb71b4-9e0a-484b-bb49-4c20c7180d60',
  '6cc8a1d7-6a81-46dd-b8a6-31c2591e1125',
  '70036895-3589-47e1-ac84-8fa5a5068c03',
  '7058279f-26b4-4379-a086-0da7a21e1862',
  '910be0dc-9ffd-484f-b37b-12130b7331f1',
  '98ce31f6-617e-43c5-b702-bdd1f31db345',
  'bf3b4806-9bb1-43a3-995b-c9c48e11a3c3',
  'c175cd58-76b2-4349-a358-4a8b66d97d25',
  'c333e896-4c25-42de-9eab-ace94c9f1b51',
  'd0632237-3906-43e5-8148-087ea626a94e',
  'd1b0ca8e-c4e1-43f7-b497-863310de0b38',
  'd263799d-a2d6-4f49-aa89-f901167c05c8',
  'e489f171-0c1d-4cf6-8e6f-41f69e551909');

UPDATE public.menu_items SET cook_time_min = 5
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '00607568-2bea-4986-9723-65e7c937440d',
  '0196ad30-cbf9-40f6-9dc7-f4a630d55b44',
  '1d5456fa-5ffa-4f10-95c3-f9f6523de2cf',
  '4ccbafc6-ca78-4ee5-9c18-629e84a010ea',
  '57351dff-a50c-49b5-9456-2ae379e73b78',
  '5e84e1d6-1ee0-4626-a567-61751b313f1a',
  '61904d28-5710-4fa8-b506-258adb1dd9dd',
  '6416b820-22f1-4dfe-8215-1ad29ce502c2',
  '6bdc2f20-a269-4868-b733-5f9f98c7981f',
  '6f37a8a6-9460-4529-978a-3a515fffb659',
  '710db2e8-dfe6-4923-a650-99ed93ece727',
  '7fb0a471-3399-498c-b412-45d85ca71630',
  '86f4b3b5-5a0b-4ffd-86ed-1c6e314882d6',
  '8dfb0f7a-d318-48b8-adb6-ca32d285deef',
  '95c8f33a-4912-4a1d-9e7d-ab744f6afb72',
  '9661b66b-5823-45b4-a196-249cd85b6495',
  '999c1f46-86a6-418c-b397-5658c6a00779',
  '9e6b1501-1486-45e4-9fa3-1fddf8f9a403',
  'acd22b24-1cd0-4ff7-ba2d-730a8fad2298',
  'b21994da-877b-4602-8332-151dc65a5288',
  'b904bcbc-c7a8-427c-ab90-1746bceff2fa',
  'bde220b0-c2a6-4750-8962-276394f50c12',
  'c1e640ea-d522-4bd3-abc9-303afb623f59',
  'cbb26b71-a497-48f9-a505-de3e1de970f5',
  'd11eebdf-f196-448f-9ddd-e8bca78d6a8e',
  'febad49d-fd58-471a-9d03-b33dee64244d');

UPDATE public.menu_items SET cook_time_min = 7
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '1f2f35fd-23d3-43b7-a928-2caf4c12adcd',
  '68db1776-a32d-42b3-9370-9059c383063b',
  '91e1a369-ad38-4f04-a4aa-c69ce5ce6b08',
  '998f1c5e-0d84-44ef-b68f-2e6300aef99c',
  'e6a5e261-8968-4b4c-b35b-08a7ebfbf5b6',
  'ea3f4583-209b-4d52-935a-56cdc3cc8a2e',
  'ee0117cb-a323-445f-82f6-694aa9b21fc1',
  'f4f8c21e-cb86-4319-ba54-ff285369bbd1',
  'f5c63ca6-513b-43af-9f67-48841beb95e4');

UPDATE public.menu_items SET cook_time_min = 8
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '364de08f-314a-47a0-ab50-3ea558d84ded',
  '64dc156d-41a9-498e-a613-2f232941741f',
  '7be7c96d-df79-43b6-b8af-464e8dfb40c5',
  '7ea38543-9d0a-4790-8aef-93620100de09',
  '9ec4ed5b-325a-450b-88de-761357a435ac',
  'e3e04963-085e-4d09-9717-82dfa6a55971');

UPDATE public.menu_items SET cook_time_min = 10
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '076097f6-1ad0-486e-a7c6-437c1d799d52',
  '1906f51b-7168-4307-b9a9-9f33ba316331',
  '35f87ec1-ec3f-4f36-b382-0cd7af5e4bf1',
  '92f052c4-1642-4921-be77-086eb990787c',
  'aad61374-eb0c-497f-87fb-fe674d91464a');

UPDATE public.menu_items SET cook_time_min = 12
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '16e1a58f-6ec9-44b0-8573-c011e4760574',
  '299cc8ae-df7c-4727-aa9e-286e06a10f94',
  '2b7acecd-d697-4a82-acd5-b4eb8b289781',
  '2f85f80f-fe3b-43b6-b44b-945eb05ff386',
  '35eb2645-4cfc-49cf-a00b-6ed496a6ef94',
  '367cde14-3cbc-4e49-957a-5b5409763ca4',
  '43f121d8-f71f-4c03-befd-84584c380989',
  '56499513-fd95-4330-9fb9-00e0f397c874',
  '5d3c6fc5-d432-4146-ba6c-ad3202a60d3a',
  '667e1041-7233-4955-8af4-bd445d54806f',
  '864ee294-0287-4690-b252-126b2c7ea239',
  '8a437dd2-ecb8-4c16-9c3b-9a9c7bdb7dd8',
  'a5d6a0a3-6871-4baa-82ee-0770625b651e',
  'acf4d5ae-7e2b-470c-a6e7-692d7deb1133',
  'af98a4d8-0a31-4dd3-9044-468bdb27f7e1',
  'b11a7d4c-0c88-4b38-b0c3-a758c355bfd4',
  'cb63d72b-39e8-42b7-9e1f-ed6d3b8b3332',
  'cf8a7084-e37a-48f7-9e3c-b69c0873a132',
  'd182dd35-bdac-4fb3-834a-fa50dd3654cc',
  'dadd1077-40fb-4f9c-9920-f96afb7a8f99',
  'eccb75f2-43ce-4339-9aef-653437d1c695',
  'f1fdbaee-1456-4dcd-aa81-02f2e9d4a4f8');

UPDATE public.menu_items SET cook_time_min = 14
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '6f7e46a8-c090-4ccc-a1a2-99f43e39e480',
  '7f7d1b16-949a-4052-8323-d5ce5608a57f');

UPDATE public.menu_items SET cook_time_min = 15
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '1dbce7ee-dfd5-4934-825e-81fbce0aebc8',
  '24bc95f3-7587-490c-800b-6dbd661e0d4c',
  '28772fea-59fc-4374-a372-5200569336dd',
  '65649abf-ed24-405b-b965-97d2cfb81a7f',
  '7cfa26b8-d21a-4311-b78f-ba22dcfc096f',
  '7e1a304d-b975-4ed2-9977-a8755782ddfa',
  '7fef0ebc-e886-4638-b72e-3ca3904a4253',
  '8a2d14cb-6022-4371-bcde-dce95e246117',
  '90de0a84-b2db-4e2d-b25e-fa0df3335764',
  '9e7886bb-9a0c-4025-ac89-fbd9a45d0ab6',
  'c615cdd0-76ae-4b52-891d-c9d10462c977',
  'c8444e2d-a222-49b7-9f7e-54d9571a3fdf',
  'cef5fc76-813d-471e-bddb-7757be216fea',
  'd1d3c68c-1208-43cb-8fab-52d2ca1f2079',
  'd57c2be2-d661-4ada-bc42-cda6471bcd97',
  'f0ef0586-d30b-43d8-92ac-50e8b00803e4',
  'f97edc51-a06a-4e36-8a3d-c2fa3f43dd88');

UPDATE public.menu_items SET cook_time_min = 16
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '52b8b437-c07e-47f5-86ff-c7c573d0c341');

UPDATE public.menu_items SET cook_time_min = 17
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '94e96573-fd18-4b0f-9a45-b10be7937e8d');

UPDATE public.menu_items SET cook_time_min = 18
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '03712938-fbb3-44dd-b6c7-8d67b94e7846',
  '237eb170-f115-4de5-aa8c-7a4f4e0f9381',
  '292d4dfd-fc63-4326-aebb-02ddbdae9592',
  '379047aa-484c-4136-9af1-6d4d49158a10',
  '3cb2d3b2-0027-4ed5-8f4a-4462c821a0f7',
  '526105f5-d94e-44ed-ac27-99fbc91c3e03',
  '6e4930e9-1873-4779-9f60-5f33e1bd71a2',
  'a7834961-42fa-4b62-bbb0-a046846be449',
  'b771104a-b531-412f-883b-4c4dddb56275',
  'fff928b4-d33d-4784-9076-fa8ca84e3b1b');

UPDATE public.menu_items SET cook_time_min = 20
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '0adff20b-7040-4889-b51e-cbbd58c1165f',
  '4ac1e9b9-4eb0-488e-8a8f-2517d25f7ab3',
  '5cc2a856-9629-4677-a8a7-d1b002464a72',
  '5edd608c-8c6f-49f5-ae53-898fd8fe93bc',
  '8d5fe409-a0c8-4b98-b2f2-7ccacdd16cb6');

UPDATE public.menu_items SET cook_time_min = 22
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '006be790-3ee6-448d-8bc1-b1b10033b436',
  '7b2a961e-7571-4449-87e0-44126f9fc8ee');

UPDATE public.menu_items SET cook_time_min = 25
WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL AND id IN (
  '034a9865-76a9-4039-aec4-e5e0e73efe3a',
  '1e187b79-60fa-4b83-b350-5c8e7fadea35',
  '2509369c-629b-40b3-8e86-dcd443726f0f',
  'a7b4b203-6940-4e49-8eb0-2081de93ef02');

-- Контроль: должно вернуть 0 (у ресторана не осталось блюд без времени).
SELECT count(*) AS without_time FROM public.menu_items WHERE restaurant_id = 'dd89773c-0952-4fd1-9510-514094a928ee' AND cook_time_min IS NULL;

COMMIT;
