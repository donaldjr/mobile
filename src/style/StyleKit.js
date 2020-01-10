import { StyleSheet, StatusBar, Alert, Platform, Dimensions } from 'react-native';
import ModelManager from "@Lib/sfjs/modelManager"
import Server from "@Lib/sfjs/httpManager"
import Sync from '@Lib/sfjs/syncManager'
import { SFItemParams } from 'standard-file-js';
import Storage from "@Lib/sfjs/storageManager"
import Auth from "@Lib/sfjs/authManager"
import KeysManager from '@Lib/keysManager'
import CSSParser from "@Style/Util/CSSParser";
import ThemeDownloader from "@Style/Util/ThemeDownloader"
import IconChanger from 'react-native-alternate-icons';

import redJSON from './Themes/red.json';
import blueJSON from './Themes/blue.json';

export const LIGHT_MODE_KEY = 'light';
export const DARK_MODE_KEY = 'dark';
export const LIGHT_CONTENT = 'light-content';
export const DARK_CONTENT = 'dark-content';
export const LIGHT_MODE_THEME_KEY = 'isMobileLightTheme';
export const DARK_MODE_THEME_KEY = 'isMobileDarkTheme';

export function themeStorageKeyForMode(mode) {
  return mode === DARK_MODE_KEY ? DARK_MODE_THEME_KEY : LIGHT_MODE_THEME_KEY;
}

export default class StyleKit {

  static instance = null;

  static get() {
    if (this.instance == null) {
      this.instance = new StyleKit();
    }

    return this.instance;
  }

  constructor() {
    this.themeChangeObservers = [];

    this.buildConstants();

    this.createDefaultThemes();

    KeysManager.get().registerAccountRelatedStorageKeys(['savedTheme']);

    ModelManager.get().addItemSyncObserver('themes', 'SN|Theme', (allItems, validItems, deletedItems, source) => {
      if(this.activeTheme && this.activeTheme.isSwapIn) {
        var matchingTheme = _.find(this.themes(), {uuid: this.activeTheme.uuid});
        if(matchingTheme) {
          this.setActiveTheme(matchingTheme);
          this.activeTheme.isSwapIn = false;
        }
      }
    });

    // once themes have synced, activate the theme for our current mode
    this.activateThemeForCurrentMode();

    this.signoutObserver = Auth.get().addEventHandler((event) => {
      if(event == SFAuthManager.DidSignOutEvent) {
        this.activateTheme(this.systemThemes[0]);
      }
    });
  }

  addThemeChangeObserver(observer) {
    this.themeChangeObservers.push(observer);
    return observer;
  }

  removeThemeChangeObserver(observer) {
    _.pull(this.themeChangeObservers, observer);
  }

  notifyObserversOfThemeChange() {
    for(var observer of this.themeChangeObservers) {
      observer();
    }
  }

  setModeTo(mode) {
    this.currentDarkMode = mode;
  }

  themeStorageKeyForCurrentMode() {
    return themeStorageKeyForMode(this.currentDarkMode);
  }

  saveThemeForMode({theme, mode}) {
    const modeToSaveFor = theme.content.isSystemTheme ? this.currentDarkMode : mode;
    const storageKey = themeStorageKeyForMode(modeToSaveFor);

    /**
      Unset the themes that were previously set for this key. We loop instead
      of finding the specific theme with the matching mode incase of any sync
      conflicts happen to assign 2 themes as the theme for a specific mode.
    */
    _.forEach(this.themes(), _theme => {
      if(_theme.content && _theme.content[storageKey]) {
        _theme.content[storageKey] = false;
        _theme.setDirty(true);
      }
    });

    // assign this new theme to this mode
    theme.content[storageKey] = true;
    theme.setDirty(true);

    /**
      If we're changing the theme for a specific mode and we're currently on
      that mode, then set this theme as active
    */
    if(this.currentDarkMode === modeToSaveFor && this.activeTheme.uuid !== theme.uuid) {
      this.setActiveTheme(theme);
    }

    Sync.get().sync();
  }

  /**
    When downloading an external theme, we can't depend on it having all the
    variables present. So we will merge them with this template variable list
    to make sure the end result has all variables the app expects. Return a
    copy as the result may be modified before use.
  */
  templateVariables() {
    return _.clone(redJSON);
  }

  createDefaultThemes() {
    this.systemThemes = [];
    let options = [
      {
        variables: blueJSON,
        name: "Blue",
        isInitial: true
      },
      {
        variables: redJSON,
        name: "Red",
      }
    ];

    for(var option of options) {
      let variables = option.variables;
      variables.statusBar = Platform.OS == 'android' ? LIGHT_CONTENT : DARK_CONTENT;

      let theme = new SNTheme({
        uuid: option.name,
        content: {
          isSystemTheme: true,
          isInitial: option.isInitial,
          name: option.name,
          variables: variables,
          package_info: {
            dock_icon: {
              type: 'circle',
              background_color: variables.stylekitInfoColor,
              border_color: variables.stylekitInfoColor
            }
          }
        }
      });

      this.systemThemes.push(theme);
    }
  }

  async resolveInitialTheme() {
    const runDefaultTheme = async () => {
      let theme;
      const savedSystemThemeId = await Storage.get().getItem('savedSystemThemeId');
      if(savedSystemThemeId) {
        theme = this.systemThemes.find((candidate) => candidate.uuid == savedSystemThemeId);
      } else {
        theme = this.systemThemes[0];
      }

      this.setActiveTheme(theme);
    }

    // Get the active theme from storage rather than waiting for local database to load
    const themeResult = await Storage.get().getItem('savedTheme');
    if(!themeResult) {
      return runDefaultTheme();
    }

    // JSON stringified content is generic and includes all items property at time of stringification
    // So we parse it, then set content to itself, so that the mapping can be handled correctly.
    try {
      const parsedTheme = JSON.parse(themeResult);
      let theme = new SNTheme(parsedTheme);
      theme.isSwapIn = true;
      this.setActiveTheme(theme);
    } catch (e) {
      console.error("Error parsing initial theme", e);
      return runDefaultTheme();
    }
  }

  static variable(name) {
    return this.get().activeTheme.content.variables[name];
  }

  static get variables() {
    return this.get().activeTheme.content.variables;
  }

  static get constants() {
    return this.get().constants;
  }

  static get styles() {
    return this.get().styles;
  }

  static stylesForKey(key) {
    var allStyles = this.styles;
    var styles = [allStyles[key]];
    var platform = Platform.OS == 'android' ? "Android" : "IOS";
    var platformStyles = allStyles[key+platform];
    if(platformStyles) {
      styles.push(platformStyles);
    }
    return styles;
  }

  statusBarColorForTheme(theme) {
    // The main nav bar uses contrast background color
    if(!theme.luminosity) {
      theme.luminosity = StyleKit.getColorLuminosity(theme.content.variables.stylekitContrastBackgroundColor);
    }

    if(theme.luminosity < 130) {
      // is dark color, return white status bar
      return LIGHT_CONTENT;
    } else {
      return DARK_CONTENT;
    }
  }

  keyboardColorForTheme(theme) {
    if(!theme.luminosity) {
      theme.luminosity = StyleKit.getColorLuminosity(theme.content.variables.stylekitContrastBackgroundColor);
    }

    if(theme.luminosity < 130) {
      // is dark color, return dark keyboard
      return DARK_MODE_KEY;
    } else {
      return LIGHT_MODE_KEY;
    }
  }

  keyboardColorForActiveTheme() {
    return this.keyboardColorForTheme(this.activeTheme);
  }

  themes() {
    let themes = ModelManager.get().themes.sort((a, b) => {
      if(!a.name || !b.name) { return -1; }
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    return this.systemThemes.concat(themes);
  }

  isThemeActive(theme) {
    if(this.activeTheme) {
      return theme.uuid == this.activeTheme.uuid;
    }
    return theme.isMobileActive();
  }

  setActiveTheme(theme) {
    const isAndroid = Platform.OS === 'android';

    // merge default variables in case this theme has variables that are missing
    let variables = theme.content.variables;
    theme.content.variables = _.merge(this.templateVariables(), variables);
    theme.setMobileActive(true);

    this.activeTheme = theme;

    // On Android, a time out is required, especially during app startup
    setTimeout(() => {
      let statusBarColor = this.statusBarColorForTheme(theme);
      StatusBar.setBarStyle(statusBarColor, true);
      // setBackgroundColor is only for Android
      if(isAndroid) {
        // Android <= v22 does not support changing status bar text color. It will always be white
        // So we have to make sure background color has proper contrast
        if(Platform.Version <= 22) {
          StatusBar.setBackgroundColor("#000000");
        } else {
          StatusBar.setBackgroundColor(theme.content.variables.stylekitContrastBackgroundColor);
        }
      }
    }, isAndroid ? 100 : 0);

    if(theme.content.isSystemTheme && !isAndroid) {
      IconChanger.supportDevice((supported) => {
        if(supported) {
          IconChanger.getIconName((currentName) => {
            if(theme.content.isInitial && currentName != 'default') {
              // Clear the icon to default
              IconChanger.setIconName(null);
            } else {
              let newName = theme.content.name;
              if(newName != currentName) {
                IconChanger.setIconName(newName);
              }
            }
          })
        }
      })
    }

    this.reloadStyles();

    this.notifyObserversOfThemeChange();
  }

  activateTheme(theme, writeToStorage = true) {
    if(this.activeTheme) {
      this.activeTheme.setMobileActive(false);
    }

    var performActivation = async () => {
      // assign this as the preferential theme for current light/dark mode the user is using
      this.saveThemeForMode({theme: theme, mode: this.currentDarkMode});

      if(theme.content.isSystemTheme) {
        Storage.get().setItem('savedSystemThemeId', theme.uuid);
        Storage.get().removeItem('savedTheme');
      } else if(writeToStorage) {
        let transformer = new SFItemParams(theme);
        let params = await transformer.paramsForLocalStorage();
        Storage.get().setItem('savedTheme', JSON.stringify(params));
        Storage.get().removeItem('savedSystemThemeId');
      }
    }

    // Theme may have been downloaded before stylekit changes. So if it doesn't have the info color,
    // it needs to be refreshed
    let hasValidInfoColor = theme.content.variables && theme.content.variables.stylekitInfoColor;
    if(!hasValidInfoColor) {
      ThemeDownloader.get().downloadTheme(theme).then((variables) => {
        if(!variables) {
          Alert.alert("Not Available", "This theme is not available on mobile.");
          return;
        }

        if(variables !== theme.content.variables) {
          theme.content.variables = variables;
          theme.setDirty(true);
        }

        if(theme.getNotAvailOnMobile()) {
          theme.setNotAvailOnMobile(false);
          theme.setDirty(true);
        }

        Sync.get().sync();
        performActivation();
      });
    } else {
      performActivation();
    }
  }

  activateThemeForCurrentMode() {
    if(this.themeChange) clearTimeout(this.themeChange);
    this.themeChange = setTimeout(() => {
      const storageKey = this.themeStorageKeyForCurrentMode();
      const matchingTheme = this.themes().find((candidate) => candidate.content[storageKey]);

      if(matchingTheme) {
        if(matchingTheme.uuid === this.activeTheme.uuid) {
          // Found a match and it's already active, no need to switch
          return;
        }

        // found a matching theme for user preference, switch to that theme
        this.activateTheme(matchingTheme);
      } else {
        // No matching theme found, set currently active theme as the default for this mode (light/dark)
        this.saveThemeForMode({theme: this.activeTheme, mode: this.currentDarkMode});
      }
    }, 300);
  }

  async downloadThemeAndReload(theme) {
    await ThemeDownloader.get().downloadTheme(theme);
    await Sync.get().sync();
    this.activateTheme(theme);
  }

  static isIPhoneX() {
    // See https://mydevice.io/devices/ for device dimensions
    const X_WIDTH = 375;
    const X_HEIGHT = 812;
    const { height: D_HEIGHT, width: D_WIDTH } = Dimensions.get('window');
    return Platform.OS === 'ios' &&
      ((D_HEIGHT === X_HEIGHT && D_WIDTH === X_WIDTH) ||
        (D_HEIGHT === X_WIDTH && D_WIDTH === X_HEIGHT));
  }

  reloadStyles() {
    let variables = this.activeTheme.content.variables;
    let mainTextFontSize = this.constants.mainTextFontSize;
    let paddingLeft = this.constants.paddingLeft;
    this.styles = {
      baseBackground: {
        backgroundColor: variables.stylekitBackgroundColor
      },
      contrastBackground: {
        backgroundColor: variables.stylekitContrastBackgroundColor
      },
      container: {
        flex: 1,
        height: '100%',
      },

      flexContainer: {
        flex: 1,
        flexDirection: 'column',
      },

      centeredContainer: {
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      },

      flexedItem: {
        flexGrow: 1
      },

      uiText: {
        color: variables.stylekitForegroundColor,
        fontSize: mainTextFontSize,
      },

      view: {

      },

      contrastView: {

      },

      tableSection: {
        marginTop: 10,
        marginBottom: 10,
        backgroundColor: variables.stylekitBackgroundColor
      },

      sectionedTableCell: {
        borderBottomColor: variables.stylekitBorderColor,
        borderBottomWidth: 1,
        paddingLeft: paddingLeft,
        paddingRight: paddingLeft,
        paddingTop: 13,
        paddingBottom: 12,
        backgroundColor: variables.stylekitBackgroundColor,
      },

      textInputCell: {
        maxHeight: 50,
        paddingTop: 0,
        paddingBottom: 0
      },

      sectionedTableCellTextInput: {
        fontSize: mainTextFontSize,
        padding: 0,
        color: variables.stylekitForegroundColor,
        height: '100%'
      },

      sectionedTableCellFirst: {
        borderTopColor: variables.stylekitBorderColor,
        borderTopWidth: 1,
      },

      sectionedTableCellLast: {

      },

      sectionedAccessoryTableCell: {
        paddingTop: 0,
        paddingBottom: 0,
        minHeight: 47,
        backgroundColor: 'transparent'
      },

      sectionedAccessoryTableCellLabel: {
        fontSize: mainTextFontSize,
        color: variables.stylekitForegroundColor,
        minWidth: '80%'
      },

      buttonCell: {
        paddingTop: 0,
        paddingBottom: 0,
        flex: 1,
        justifyContent: 'center'
      },

      buttonCellButton: {
        textAlign: 'center',
        textAlignVertical: 'center',
        color: Platform.OS == 'android' ? variables.stylekitForegroundColor : variables.stylekitInfoColor,
        fontSize: mainTextFontSize,
      },

      buttonCellButtonLeft: {
        textAlign: 'left',
      },

      noteText: {
        flexGrow: 1,
        marginTop: 0,
        paddingTop: 10,
        color: variables.stylekitForegroundColor,
        paddingLeft: paddingLeft,
        paddingRight: paddingLeft,
        paddingBottom: 10,
        backgroundColor: variables.stylekitBackgroundColor
      },

      noteTextIOS: {
        paddingLeft: paddingLeft - 5,
        paddingRight: paddingLeft - 5,
      },

      noteTextNoPadding: {
        paddingLeft: 0,
        paddingRight: 0
      },

      actionSheetWrapper: {

      },

      actionSheetOverlay: {
        // This is the dimmed background
        // backgroundColor: variables.stylekitNeutralColor
      },

      actionSheetBody: {
        // This will also set button border bottoms, since margin is used instead of borders
        backgroundColor: variables.stylekitBorderColor
      },

      actionSheetTitleWrapper: {
        backgroundColor: variables.stylekitBackgroundColor,
        marginBottom: 1
      },

      actionSheetTitleText: {
        color: variables.stylekitForegroundColor,
        opacity: 0.5
      },

      actionSheetButtonWrapper: {
        backgroundColor: variables.stylekitBackgroundColor,
        marginTop: 0
      },

      actionSheetButtonTitle: {
        color: variables.stylekitForegroundColor,
      },

      actionSheetCancelButtonWrapper: {
        marginTop: 0
      },

      actionSheetCancelButtonTitle: {
        color: variables.stylekitInfoColor,
        fontWeight: 'normal'
      },

      bold: {
        fontWeight: 'bold'
      },
    }
  }

  buildConstants() {
    this.constants = {
      mainTextFontSize: 16,
      paddingLeft: 14
    }
  }

  static platformIconPrefix() {
    return Platform.OS == 'android' ? 'md' : 'ios';
  }

  static nameForIcon(iconName) {
    return StyleKit.platformIconPrefix() + "-" + iconName;
  }

  static getColorLuminosity(hexCode) {
    var c = hexCode;
    c = c.substring(1);      // strip #
    var rgb = parseInt(c, 16);   // convert rrggbb to decimal
    var r = (rgb >> 16) & 0xff;  // extract red
    var g = (rgb >>  8) & 0xff;  // extract green
    var b = (rgb >>  0) & 0xff;  // extract blue

    return 0.2126 * r + 0.7152 * g + 0.0722 * b; // per ITU-R BT.709
  }

  static shadeBlend(p,c0,c1) {
    var n=p<0?p*-1:p,u=Math.round,w=parseInt;
    if(c0.length>7){
      var f=c0.split(","),t=(c1?c1:p<0?"rgb(0,0,0)":"rgb(255,255,255)").split(","),R=w(f[0].slice(4)),G=w(f[1]),B=w(f[2]);
      return "rgb("+(u((w(t[0].slice(4))-R)*n)+R)+","+(u((w(t[1])-G)*n)+G)+","+(u((w(t[2])-B)*n)+B)+")"
    } else{
      var f=w(c0.slice(1),16),t=w((c1?c1:p<0?"#000000":"#FFFFFF").slice(1),16),R1=f>>16,G1=f>>8&0x00FF,B1=f&0x0000FF;
      return "#"+(0x1000000+(u(((t>>16)-R1)*n)+R1)*0x10000+(u(((t>>8&0x00FF)-G1)*n)+G1)*0x100+(u(((t&0x0000FF)-B1)*n)+B1)).toString(16).slice(1)
    }
  }

  static darken(color, value = -0.15) {
    return this.shadeBlend(value, color);
  }

  static lighten(color, value = 0.25) {
    return this.shadeBlend(value, color);
  }

  static hexToRGBA(hex, alpha) {
    if(!hex || !hex.startsWith("#")) {
      return null;
    }
    var c;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
      c= hex.substring(1).split('');
      if(c.length== 3){
          c= [c[0], c[0], c[1], c[1], c[2], c[2]];
      }
      c= '0x'+c.join('');
      return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+',' + alpha + ')';
    } else {
      throw new Error('Bad Hex');
    }
  }

}
