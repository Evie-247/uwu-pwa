// --- 天气服务模块 (js/modules/weather.js) ---

class WeatherService {
    constructor() {
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时缓存
        this.cache = {};
        try {
            const savedCache = localStorage.getItem('ovo_weather_cache');
            if (savedCache) {
                this.cache = JSON.parse(savedCache);
            }
        } catch (e) {
            console.warn('读取天气缓存失败:', e);
        }
    }

    /**
     * 获取角色的天气配置并拉取天气数据，转化为自然语言提示词
     * @param {Object} character - 角色对象
     * @returns {Promise<string>} 返回自然语言的天气提示词，如果获取失败或未开启则返回空字符串
     */
    async getCharacterWeatherPrompt(character) {
        if (!character || !character.weatherSettings || !character.weatherSettings.charEnabled) {
            return '';
        }

        const city = character.weatherSettings.charCity;
        if (!city) return '';

        // 确定使用哪个 API 源和 Key
        let provider = 'openmeteo';
        let apiKey = '';

        if (character.weatherSettings.customApiEnabled) {
            provider = character.weatherSettings.provider || 'openmeteo';
            apiKey = character.weatherSettings.apiKey || '';
        } else if (db.weatherApiSettings) {
            provider = db.weatherApiSettings.provider || 'openmeteo';
            apiKey = db.weatherApiSettings.key || '';
        }

        try {
            const weatherData = await this.fetchWeather(provider, city, apiKey);
            return `[System Notice] 你当前所在的地区（${city}）天气：${weatherData.condition}，气温：${weatherData.temperature}。仅作为背景设定参考，除非用户提及或话题强相关，否则不要主动谈论天气`;
        } catch (error) {
            console.warn(`获取角色(${character.remarkName})天气失败:`, error);
            return '';
        }
    }

    /**
     * 获取用户的天气配置并拉取天气数据，转化为自然语言提示词
     * @param {Object} character - 角色对象 (从中读取用户的天气配置)
     * @returns {Promise<string>} 返回自然语言的天气提示词，如果获取失败或未开启则返回空字符串
     */
    async getUserWeatherPrompt(character) {
        if (!character || !character.weatherSettings || !character.weatherSettings.userEnabled) {
            return '';
        }

        const city = character.weatherSettings.userCity;
        if (!city) return '';

        // 用户天气统一使用全局 API 设置
        let provider = 'openmeteo';
        let apiKey = '';
        if (db.weatherApiSettings) {
            provider = db.weatherApiSettings.provider || 'openmeteo';
            apiKey = db.weatherApiSettings.key || '';
        }

        try {
            const weatherData = await this.fetchWeather(provider, city, apiKey);
            return `[System Notice] 与你对话的用户所在的地区（${city}）天气：${weatherData.condition}，气温：${weatherData.temperature}。仅作为背景设定参考，除非用户提及或话题强相关，否则不要主动谈论天气`;
        } catch (error) {
            console.warn(`获取用户天气失败:`, error);
            return '';
        }
    }

    /**
     * 根据指定的提供商拉取天气数据
     */
    async fetchWeather(provider, cityOrCoords, apiKey) {
        const cacheKey = `${provider}_${cityOrCoords}`;
        const now = Date.now();

        if (this.cache[cacheKey] && (now - this.cache[cacheKey].timestamp < this.CACHE_DURATION)) {
            return this.cache[cacheKey].data;
        }

        let data = null;

        switch (provider) {
            case 'openmeteo':
                data = await this.fetchOpenMeteo(cityOrCoords);
                break;
            case 'wttrin':
                data = await this.fetchWttrin(cityOrCoords);
                break;
            case 'qweather':
                data = await this.fetchQWeather(cityOrCoords, apiKey);
                break;
            case 'seniverse':
                data = await this.fetchSeniverse(cityOrCoords, apiKey);
                break;
            default:
                data = await this.fetchOpenMeteo(cityOrCoords); // 默认 Open-Meteo
        }

        if (data) {
            this.cache[cacheKey] = {
                data: data,
                timestamp: now
            };
            try {
                localStorage.setItem('ovo_weather_cache', JSON.stringify(this.cache));
            } catch (e) {
                console.warn('保存天气缓存失败:', e);
            }
        }

        return data;
    }

    // --- 各种 API 源的实现 ---

    async fetchWttrin(city) {
        // wttr.in 非常简单，直接请求 JSON
        // 注意：如果是经纬度，wttr.in 可能解析不如专门的 geocoding 服务好，但通常格式为 lat,lon 也支持
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh-cn`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('wttr.in 请求失败');
        const json = await res.json();
        
        const current = json.current_condition[0];
        const temp = current.temp_C + '℃';
        const condition = current.lang_zh && current.lang_zh[0] ? current.lang_zh[0].value : current.weatherDesc[0].value;
        
        return { temperature: temp, condition: condition };
    }

    async fetchOpenMeteo(cityOrCoords) {
        let lat, lon;
        // 简单判断是否是经纬度 (如 "31.23,121.47")
        if (/^[-+]?\d+(\.\d+)?,[-+]?\d+(\.\d+)?$/.test(cityOrCoords)) {
            const parts = cityOrCoords.split(',');
            lat = parts[0];
            lon = parts[1];
        } else {
            // 如果是城市名，先调用 Open-Meteo 的 Geocoding API
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityOrCoords)}&count=1&language=zh`;
            const geoRes = await fetch(geoUrl);
            if (!geoRes.ok) throw new Error('Open-Meteo Geocoding 请求失败');
            const geoJson = await geoRes.json();
            if (!geoJson.results || geoJson.results.length === 0) {
                throw new Error('未找到该城市坐标');
            }
            lat = geoJson.results[0].latitude;
            lon = geoJson.results[0].longitude;
        }

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
        const res = await fetch(weatherUrl);
        if (!res.ok) throw new Error('Open-Meteo Weather 请求失败');
        const json = await res.json();
        
        const temp = json.current_weather.temperature + '℃';
        const wmoCode = json.current_weather.weathercode;
        const condition = this.wmoCodeToText(wmoCode);

        return { temperature: temp, condition: condition };
    }

    async fetchQWeather(cityOrCoords, apiKey) {
        if (!apiKey) throw new Error('和风天气需要 API Key');
        
        let location = cityOrCoords;
        // 检查是否已经是坐标
        if (/^[-+]?\d+(\.\d+)?,[-+]?\d+(\.\d+)?$/.test(cityOrCoords)) {
            const parts = cityOrCoords.split(',');
            location = `${parts[1]},${parts[0]}`; // 和风天气格式为 经度,纬度
        } else {
            // 需要调用和风 Geo API 获取 Location ID (为了稳定推荐先转ID，但新版可以直接传文字)
            const geoUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(cityOrCoords)}&key=${apiKey}`;
            const geoRes = await fetch(geoUrl);
            const geoJson = await geoRes.json();
            if (geoJson.code !== '200' || !geoJson.location || geoJson.location.length === 0) {
                throw new Error('和风天气城市搜索失败: ' + geoJson.code);
            }
            location = geoJson.location[0].id;
        }

        const url = `https://devapi.qweather.com/v7/weather/now?location=${encodeURIComponent(location)}&key=${apiKey}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.code !== '200') throw new Error('和风天气请求失败: ' + json.code);

        return {
            temperature: json.now.temp + '℃',
            condition: json.now.text
        };
    }

    async fetchSeniverse(cityOrCoords, apiKey) {
        if (!apiKey) throw new Error('心知天气需要 API Key');
        
        // 心知天气 location 参数支持 拼音、汉字、ip、经纬度 (格式 lat:lon)
        let location = cityOrCoords;
        if (/^[-+]?\d+(\.\d+)?,[-+]?\d+(\.\d+)?$/.test(cityOrCoords)) {
            const parts = cityOrCoords.split(',');
            location = `${parts[0]}:${parts[1]}`;
        }

        const url = `https://api.seniverse.com/v3/weather/now.json?key=${apiKey}&location=${encodeURIComponent(location)}&language=zh-Hans&unit=c`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('心知天气请求失败');
        const json = await res.json();
        
        if (!json.results || json.results.length === 0) throw new Error('心知天气未返回结果');

        const now = json.results[0].now;
        return {
            temperature: now.temperature + '℃',
            condition: now.text
        };
    }

    // Open-Meteo WMO 代码转换
    wmoCodeToText(code) {
        const codes = {
            0: '晴朗',
            1: '大部晴朗', 2: '部分多云', 3: '阴天',
            45: '有雾', 48: '有沉积雾',
            51: '毛毛雨', 53: '毛毛雨', 55: '密集的毛毛雨',
            56: '冰冻的毛毛雨', 57: '密集的冰冻毛毛雨',
            61: '小雨', 63: '中雨', 65: '大雨',
            66: '冻雨', 67: '冻雨',
            71: '小雪', 73: '中雪', 75: '大雪',
            77: '雪粒',
            80: '小阵雨', 81: '中阵雨', 82: '大阵雨',
            85: '小阵雪', 86: '大阵雪',
            95: '雷阵雨',
            96: '雷阵雨伴有冰雹', 99: '强雷阵雨伴有冰雹'
        };
        return codes[code] || '未知';
    }
}

window.WeatherService = new WeatherService();
