// C:\RestAI\restai-pwa\parser.cjs

const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js'); 
const puppeteer = require('puppeteer');

// ==========================================================
//                 1. НАСТРОЙКИ КОНФИГУРАЦИИ
// ==========================================================

const SUPABASE_URL = 'https://utdfzrpkoscyikitceow.supabase.co'; 
const SUPABASE_KEY = 'sb_secret_eas5r2icy294EMvBE_iv0A_2PdYWApT'; 

const RESTAURANT_ID = 'dd89773c-0952-4fd1-9510-514094a928ee'; 
const TARGET_URL = 'https://www.syrovarnya.com/catalog/usacheva'; 
const BASE_URL = 'https://www.syrovarnya.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================================
//                2. ФУНКЦИИ ПАРСИНГА ДЕТАЛЕЙ
// ==========================================================

async function parseDetailsPage(url, productType) {
    if (!url) return {};
    try {
        await new Promise(resolve => setTimeout(resolve, 500)); 
        const { data } = await axios.get(url, { timeout: 15000 });
        const $ = cheerio.load(data);
        
        let details = {
            description: null,
            weight_g: null, 
            nutritional_info: null,
            ingredients: null,
            specific_details: null 
        };

        // --- Извлечение веса ---
        const weightTextDetail = $('[class*="Product_Product__inner_desc_info_buttons_discountprice_price_weight__"]').text().trim().replace('/ ', ''); 
        details.weight_g = weightTextDetail || null;
        
        // --- Извлечение описания ---
        const descriptionText = $('[role="tabpanel"][id$="_0"] p[class*="Product__inner_desc_info_content_tabpanels_tabpanel_desc__"]').text().trim();
        details.description = descriptionText || null;
        
        // --- Извлечение состава (массив) ---
        const ingredientsText = $('[role="tabpanel"][id$="_2"] p[class*="Product__inner_desc_info_content_tabpanels_tabpanel_desc__"]').text().trim();
        if (ingredientsText) {
            const ingredientArray = ingredientsText.split(',').map(item => item.trim()).filter(item => item.length > 0);
            details.ingredients = ingredientArray.length > 0 ? ingredientArray : null; 
        }

        // --- ВСТАВКА: Извлечение КБЖУ (Ваш старый код) ---
        const $nutritionalPanel = $('.Product_energy__inner__mP9T5');
        if ($nutritionalPanel.length > 0) {
            let nutritionalData = {};
            $nutritionalPanel.find('p').each((i, pElement) => {
                const text = $(pElement).text().trim();
                const valueMatch = text.match(/([\d\.]+)/);
                const titleMatch = text.match(/(ккал|белки|жиры|углеводы)/);

                if (valueMatch && titleMatch) {
                    const value = parseFloat(valueMatch[1]);
                    const title = titleMatch[1];

                    if (title === 'ккал') nutritionalData.calories_kcal = value;
                    else if (title === 'белки') nutritionalData.protein_g = value;
                    else if (title === 'жиры') nutritionalData.fat_g = value;
                    else if (title === 'углеводы') nutritionalData.carbs_g = value;
                }
            });

            if (Object.keys(nutritionalData).length > 0) {
                details.nutritional_info = nutritionalData;
            }
        }
        
        // --- Обработка специфических деталей веса ---
        if (details.weight_g) {
            let weightMatch = details.weight_g.match(/(\d+)\s*(г|мл|л)/i);
            if (weightMatch) {
                details.specific_details = {
                    weight_value: parseInt(weightMatch[1]),
                    weight_unit: weightMatch[2].toLowerCase()
                };
            }
        }
        return details;
    } catch (error) {
        console.error(`Ошибка парсинга деталей для ${url}: ${error.message}`);
        return {};
    }
}

// ==========================================================
//                3. ФУНКЦИИ ПАРСИНГА МЕНЮ
// ==========================================================

async function autoScroll(page){
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100; 
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if(totalHeight >= scrollHeight){
                    clearInterval(timer);
                    resolve();
                }
            }, 100); 
        });
    });
}

async function parseMenu() {
    console.log(`--- Начинаем парсинг меню: ${TARGET_URL} ---`);
    let browser;
    const CATALOG_MAIN_SELECTOR = '[class*="Catalog_Catalog__inner_menu__"]';
    const LIST_CONTAINER_SELECTOR = '[class*="Catalog_Catalog__inner_menu_section_inner_list__"]';
    const CARD_SELECTOR = '[class*="ProductCard_ProductCard__"]';
    const SECTION_SELECTOR = '[class*="Catalog_Catalog__inner_menu_section__"]';

    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); 
        await page.waitForSelector(CARD_SELECTOR, { timeout: 30000 }); 
        await autoScroll(page);
        
        const htmlContent = await page.content();
        await browser.close();
        
        const $ = cheerio.load(htmlContent);
        let itemsWithLinks = [];
        const processedKeys = new Set();
        let currentSectionPriority = 1;

        $(CATALOG_MAIN_SELECTOR).find(SECTION_SELECTOR).each((index, sectionElement) => {
            const $section = $(sectionElement);
            const sectionName = $section.find('[class*="Catalog_Catalog__inner_menu_section_inner_head_title__"]').text().trim();
            
            if (!sectionName) return; 
            console.log(`\n[РАЗДЕЛ]: ${sectionName} (Приоритет: ${currentSectionPriority})`);

            $section.find(LIST_CONTAINER_SELECTOR).find('[class*="Catalog_Catalog__inner_menu_section_inner_list_item__V_gXi"]').each((dishIndex, listItemElement) => {
                const $listItem = $(listItemElement);
                const $dish = $listItem.find(CARD_SELECTOR);
                const detailLinkElement = $dish.find('a[href*="/catalog/product/"]').first();

                if ($dish.length === 0 || detailLinkElement.length === 0) return true;

                const name = $dish.find('[class*="ProductCard_ProductCard__inner_title__"] p').text().trim() || $dish.find('img').attr('alt') || "Нет названия";
                
                const uniqueKey = `${name}_${sectionName}`;
                if (processedKeys.has(uniqueKey)) return true;
                processedKeys.add(uniqueKey);

                const price = parseFloat($dish.find('[itemProp="price"]').text().trim().replace('₽', '').replace(/\s/g, '').replace(',', '.'));

                itemsWithLinks.push({
                    detail_url: detailLinkElement.attr('href') ? `${BASE_URL}${detailLinkElement.attr('href')}` : null,
                    restaurant_id: RESTAURANT_ID,
                    dish_name: name,
                    menu_section: sectionName,
                    section_order: currentSectionPriority,
                    cost_rub: price,
                    product_type: (/(вино|пиво|коктейли|напитки|чай|кофе)/i.test(sectionName)) ? 'drink' : 'food',
                    weight_g: $dish.find('[class*="ProductCard_ProductCard__inner_weight__"]').text().trim() || null, 
                    image_url: $dish.find('img').attr('src') || null,
                });
            });
            currentSectionPriority++;
        });

        const finalMenu = [];
        for (let i = 0; i < itemsWithLinks.length; i++) {
            const item = itemsWithLinks[i];
            process.stdout.write(`\rДетализация: ${i + 1}/${itemsWithLinks.length} - ${item.dish_name}`);
            
            let details = item.detail_url ? await parseDetailsPage(item.detail_url, item.product_type) : {};
            
            finalMenu.push({
                ...item,
                description: details.description || null,
                weight_g: details.weight_g || item.weight_g, 
                nutritional_info: details.nutritional_info || null,
                ingredients: details.ingredients || null, 
                specific_details: details.specific_details || null
            });
        }
        
        await uploadToSuperbase(finalMenu);

    } catch (error) {
        if (browser) await browser.close();
        console.error('\nКРИТИЧЕСКАЯ ОШИБКА:', error.message);
    }
}

async function uploadToSuperbase(data) {
    if (data.length === 0) return;
    console.log(`\n--- Загрузка ${data.length} записей в Supabase... ---`);
    const dataToInsert = data.map(({ detail_url, ...rest }) => rest);
    try {
        await supabase.from('menu_items').delete().eq('restaurant_id', RESTAURANT_ID);
        const { error: insertError } = await supabase.from('menu_items').insert(dataToInsert); 
        if (insertError) console.error('ОШИБКА INSERT:', insertError);
        else console.log(`\n✅ УСПЕХ! Данные (включая КБЖУ) обновлены.`);
    } catch (e) {
        console.error('ОШИБКА ПОДКЛЮЧЕНИЯ:', e.message);
    }
}

parseMenu();