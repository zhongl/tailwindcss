import _ from 'lodash'
import postcss from 'postcss'
import purgecss from '@fullhuman/postcss-purgecss'
import log from '../util/log'
import flattenColorPalette from '../util/flattenColorPalette'

function removeTailwindMarkers(css) {
  css.walkAtRules('tailwind', rule => rule.remove())
  css.walkComments(comment => {
    switch (comment.text.trim()) {
      case 'tailwind start components':
      case 'tailwind start utilities':
      case 'tailwind end components':
      case 'tailwind end utilities':
        comment.remove()
        break
      default:
        break
    }
  })
}

export default function purgeUnusedUtilities(config, configChanged) {
  const purgeEnabled = _.get(
    config,
    'purge.enabled',
    config.purge !== false && config.purge !== undefined && process.env.NODE_ENV === 'production'
  )

  if (!purgeEnabled) {
    return removeTailwindMarkers
  }

  // Skip if `purge: []` since that's part of the default config
  if (Array.isArray(config.purge) && config.purge.length === 0) {
    if (configChanged) {
      log.warn([
        'Tailwind is not purging unused styles because no template paths have been provided.',
        'If you have manually configured PurgeCSS outside of Tailwind or are deliberately not removing unused styles, set `purge: false` in your Tailwind config file to silence this warning.',
        'https://tailwindcss.com/docs/controlling-file-size/#removing-unused-css',
      ])
    }

    return removeTailwindMarkers
  }

  return postcss([
    function(css) {
      const mode = _.get(config, 'purge.mode', 'conservative')

      if (mode === 'conservative') {
        css.prepend(postcss.comment({ text: 'purgecss start ignore' }))
        css.append(postcss.comment({ text: 'purgecss end ignore' }))

        css.walkComments(comment => {
          switch (comment.text.trim()) {
            case 'tailwind start utilities':
              comment.text = 'purgecss end ignore'
              break
            case 'tailwind end utilities':
              comment.text = 'purgecss start ignore'
              break
            default:
              break
          }
        })
      }
    },
    removeTailwindMarkers,
    purgecss({
      content: Array.isArray(config.purge) ? config.purge : config.purge.content,
      defaultExtractor: content => {
        // Capture as liberally as possible, including things like `h-(screen-1.5)`
        const broadMatches = content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || []

        // Capture classes within other delimiters like .block(class="w-1/2") in Pug
        const innerMatches = content.match(/[^<>"'`\s.(){}[\]#=%]*[^<>"'`\s.(){}[\]#=%:]/g) || []

        const allMatches = _.flatMap(broadMatches.concat(innerMatches), className => {
          let match

          if (!(match = className.match(/.*{(.+)}.*/))) {
            return className
          }

          const [_className, themeKey] = match

          function flattenThemeKeys(themeObject) {
            if (!_.isPlainObject(themeObject)) {
              return []
            }

            return _.flatMap(Object.keys(themeObject), key => {
              if (_.isPlainObject(themeObject[key])) {
                return flattenThemeKeys(themeObject[key]).map(childKey => `${key}-${childKey}`)
              }

              return key
            })
          }

          const dynamicMatches = flattenThemeKeys(config.theme[themeKey])
            .map(key => {
              return className.replace(`{${themeKey}}`, key)
            })
            .concat(_.trim(className.replace(`{${themeKey}}`, ''), config.separator))

          return dynamicMatches
        })

        return allMatches
      },
      ...config.purge.options,
    }),
  ])
}
