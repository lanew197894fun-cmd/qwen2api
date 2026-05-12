const { getLatestModels } = require('../models/models-map.js')
const config = require('../config/index.js')

/**
 * 構造對外暴露的模型資訊
 * @param {object} model - 原始模型資訊
 * @param {string} suffix - 變體字尾
 * @returns {object} 對外模型資訊
 */
const buildPublicModelData = (model, suffix = '') => {
    const modelData = JSON.parse(JSON.stringify(model))
    const upstreamModelID = String(model?.id || '')
    const displayModelID = String(model?.name || model?.id || '')

    modelData.id = `${displayModelID}${suffix}`
    modelData.name = `${upstreamModelID}${suffix}`
    modelData.upstream_id = upstreamModelID
    modelData.display_name = displayModelID

    return modelData
}

const handleGetModels = async (req, res) => {
    const models = []

    const ModelsMap = await getLatestModels()

    for (const model of ModelsMap) {
        models.push(buildPublicModelData(model))

        if (config.simpleModelMap) {
            continue
        }

        const isThinking = model?.info?.meta?.abilities?.thinking
        const isSearch = model?.info?.meta?.chat_type?.includes('search')
        const isImage = model?.info?.meta?.chat_type?.includes('t2i')
        const isVideo = model?.info?.meta?.chat_type?.includes('t2v')
        const isImageEdit = model?.info?.meta?.chat_type?.includes('image_edit')
        const isDeepResearch = model?.info?.meta?.chat_type?.includes('deep_research')

        if (isThinking) {
            models.push(buildPublicModelData(model, '-thinking'))
        }

        if (isSearch) {
            models.push(buildPublicModelData(model, '-search'))
        }

        if (isThinking && isSearch) {
            models.push(buildPublicModelData(model, '-thinking-search'))
        }

        if (isImage) {
            models.push(buildPublicModelData(model, '-image'))
        }

        if (isVideo) {
            models.push(buildPublicModelData(model, '-video'))
        }

        if (isImageEdit) {
            models.push(buildPublicModelData(model, '-image-edit'))
        }

        // if (isDeepResearch) {
        //     models.push(buildPublicModelData(model, '-deep-research'))
        // }
    }
    res.json({
        "object": "list",
        "data": models
    })
}

module.exports = {
    handleGetModels
}
