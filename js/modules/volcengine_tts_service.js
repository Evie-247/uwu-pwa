// js/modules/volcengine_tts_service.js
// Volcengine (豆包) TTS 语音合成服务
// 官方文档: https://www.volcengine.com/docs/6561/79820

const VolcengineTTSService = {
    // 合成语音
    synthesize: async function(text, voiceId, config, options = {}) {
        const cleanText = this.cleanText(text);
        if (!cleanText) {
            throw new Error('文本为空');
        }

        const speed = Math.min(2, Math.max(0.5, Number(options.speed) || 1));
        // 将 speed (0.5~2.0) 映射到火山的 speed_ratio (0.2~3.0，默认 1.0)
        const speedRatio = speed;

        console.log('[Volcengine TTS] 开始合成:', { text: cleanText, voiceId, speed: speedRatio });

        try {
            // 火山引擎标准 API 地址
            const url = 'https://openspeech.bytedance.com/api/v1/tts';
            
            // 构建请求 Header
            const headers = {
                'Authorization': `Bearer;${config.accessToken}`, // 新版鉴权：Bearer;{token}
                'Content-Type': 'application/json'
            };

            // 构建请求 Body，适应新版参数规范
            const requestBody = {
                app: {
                    appid: config.appId,
                    token: config.accessToken, // 传入实际 token
                    cluster: config.cluster || 'volcano_tts'
                },
                user: {
                    uid: 'ovo_user'
                },
                audio: {
                    voice_type: voiceId,
                    encoding: 'mp3',
                    speed_ratio: speedRatio,
                    volume_ratio: 1.0,
                    pitch_ratio: 1.0
                },
                request: {
                    reqid: this.generateUUID(),
                    text: cleanText,
                    text_type: 'plain',
                    operation: 'query'
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[Volcengine TTS] API 错误:', response.status, errorText);
                throw new Error(`API 请求失败: ${response.status}`);
            }

            const result = await response.json();

            // 检查响应
            if (result.code !== 3000) {
                console.error('[Volcengine TTS] API 返回错误:', result);
                throw new Error(`API 错误: ${result.message || '未知错误'} (Code: ${result.code})`);
            }

            if (!result.data) {
                throw new Error('API 返回数据为空');
            }

            // 将 Base64 编码的音频数据转换为 Blob URL
            const blob = this.base64ToBlob(result.data, 'audio/mpeg');
            const audioUrl = URL.createObjectURL(blob);

            console.log('[Volcengine TTS] 合成成功');
            return audioUrl;

        } catch (err) {
            console.error('[Volcengine TTS] 合成失败:', err);
            throw err;
        }
    },

    // 清理文本（移除特殊标记、旁白）
    cleanText: function(text) {
        if (!text) return '';
        let cleaned = text.replace(/\[.*?\]/g, '');
        cleaned = cleaned.replace(/[\(（].*?[\)）]/g, '');
        cleaned = cleaned.replace(/「.*?」/g, '');
        return cleaned.trim();
    },

    // 生成随机 UUID 作为 reqid
    generateUUID: function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // Base64 转 Blob
    base64ToBlob: function(base64, mimeType = 'audio/mpeg') {
        try {
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray], { type: mimeType });
        } catch (err) {
            console.error('[Volcengine TTS] Base64 转换失败:', err);
            throw new Error('音频数据转换失败');
        }
    }
};

window.VolcengineTTSService = VolcengineTTSService;
