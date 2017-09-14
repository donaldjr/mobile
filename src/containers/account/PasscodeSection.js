import React, { Component } from 'react';
import GlobalStyles from "../../Styles"
import {TextInput, View, Alert} from 'react-native';

import SectionHeader from "../../components/SectionHeader";
import ButtonCell from "../../components/ButtonCell";
import TableSection from "../../components/TableSection";
import SectionedTableCell from "../../components/SectionedTableCell";
import SectionedAccessoryTableCell from "../../components/SectionedAccessoryTableCell";

import FingerprintScanner from 'react-native-fingerprint-scanner';

export default class PasscodeSection extends Component {

  constructor(props) {
    super(props);
    this.state = {fingerprintAvailable: false || __DEV__};

    if(!__DEV__) {
      FingerprintScanner.isSensorAvailable()
      .then(function(){
        this.setState({fingerprintAvailable: true})
        console.log("Fingerprint then called");
      }.bind(this))
      .catch(function(error){
        this.setState({fingerprintAvailable: false})
        console.log("Fingerprint error", error);
      }.bind(this))
    }
  }

  componentWillUnmount() {
    FingerprintScanner.release();
  }

  render() {
    var passcodeTitle = this.props.hasPasscode ? "Disable Passcode Lock" : "Enable Passcode Lock";
    var passcodeOnPress = this.props.hasPasscode ? this.props.onDisable : this.props.onEnable;

    var fingerprintTitle = this.props.hasFingerprint ? "Disable Fingerprint Lock" : "Enable Fingerprint Lock";
    var fingerprintOnPress = this.props.hasFingerprint ? this.props.onFingerprintDisable : this.props.onFingerprintEnable;

    if(!this.state.fingerprintAvailable) {
      fingerprintTitle = "Enable Fingerprint Lock (Not Available)"
      fingerprintOnPress = function() {
        Alert.alert("Not Available", "Your device does not support fingerprint authentication.");
      }
    }
    return (
      <TableSection>

        <SectionHeader title={this.props.title} />

        <SectionedTableCell buttonCell={true} first={true}>
          <ButtonCell leftAligned={true} title={passcodeTitle} onPress={passcodeOnPress} />
        </SectionedTableCell>

        <SectionedTableCell buttonCell={true}>
          <ButtonCell disabled={!this.state.fingerprintAvailable} leftAligned={true} title={fingerprintTitle} onPress={fingerprintOnPress} />
        </SectionedTableCell>

      </TableSection>
    );
  }
}