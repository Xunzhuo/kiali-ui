import * as React from 'react';
import { Button, Tooltip, ButtonVariant, TextInput, Form } from '@patternfly/react-core';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';
import { bindActionCreators } from 'redux';
import { KialiAppState } from '../../../store/Store';
import { findValueSelector, hideValueSelector, edgeLabelsSelector } from '../../../store/Selectors';
import { GraphToolbarActions } from '../../../actions/GraphToolbarActions';
import { KialiAppAction } from '../../../actions/KialiAppAction';
import GraphHelpFind from '../../../pages/Graph/GraphHelpFind';
import { CyNode, CyEdge } from '../../../components/CytoscapeGraph/CytoscapeGraphUtils';
import * as CytoscapeGraphUtils from '../../../components/CytoscapeGraph/CytoscapeGraphUtils';
import { EdgeLabelMode, NodeType, Layout } from '../../../types/Graph';
import * as AlertUtils from '../../../utils/AlertUtils';
import { KialiIcon, defaultIconStyle } from 'config/KialiIcon';
import { style } from 'typestyle';
import TourStopContainer from 'components/Tour/TourStop';
import { GraphTourStops } from 'pages/Graph/GraphHelpTour';
import { TimeInMilliseconds } from 'types/Common';
import { AutoComplete } from 'utils/AutoComplete';
import { DEGRADED, FAILURE, HEALTHY } from 'types/Health';
import { GraphFindOptions } from './GraphFindOptions';
import history, { HistoryManager, URLParam } from '../../../app/History';

type ReduxProps = {
  compressOnHide: boolean;
  edgeLabels: EdgeLabelMode[];
  findValue: string;
  hideValue: string;
  layout: Layout;
  showFindHelp: boolean;
  showIdleNodes: boolean;
  showRank: boolean;
  showSecurity: boolean;
  updateTime: TimeInMilliseconds;

  setEdgeLabels: (vals: EdgeLabelMode[]) => void;
  setFindValue: (val: string) => void;
  setHideValue: (val: string) => void;
  toggleFindHelp: () => void;
  toggleGraphSecurity: () => void;
  toggleIdleNodes: () => void;
  toggleRank: () => void;
};

type GraphFindProps = ReduxProps & {
  cy: any;
  elementsChanged: boolean;
};

type GraphFindState = {
  findError?: string;
  findInputValue: string;
  hideError?: string;
  hideInputValue: string;
};

type ParsedExpression = {
  target: 'node' | 'edge';
  selector: string;
};

const inputWidth = {
  width: 'var(--graph-find-input--width)'
};

// reduce toolbar padding from 20px to 10px to save space
const thinGroupStyle = style({
  paddingLeft: '10px',
  paddingRight: '10px'
});

const operands: string[] = [
  '%grpcerr',
  '%grpctraffic',
  '%httperr',
  '%httptraffic',
  'app',
  'circuitbreaker',
  'cluster',
  'destprincipal',
  'faultinjection',
  'grpc',
  'grpcerr',
  'grpcin',
  'grpcout',
  'healthy',
  'http',
  'httpin',
  'httpout',
  'idle',
  'mirroring',
  'mtls',
  'name',
  'namespace',
  'node',
  'operation',
  'outside',
  'protocol',
  'rank',
  'requestrouting',
  'requesttimeout',
  'responsetime',
  'service',
  'serviceentry',
  'sidecar',
  'sourceprincipal',
  'tcp',
  'tcptrafficshifting',
  'throughput',
  'traffic',
  'trafficshifting',
  'trafficsource',
  'version',
  'virtualservice',
  'tcpin',
  'tcpout',
  'workload',
  'workloadentry'
];

export class GraphFind extends React.Component<GraphFindProps, GraphFindState> {
  static contextTypes = {
    router: () => null
  };

  private findAutoComplete: AutoComplete;
  private findInputRef;
  private hiddenElements: any | undefined;
  private hideAutoComplete: AutoComplete;
  private hideInputRef;
  private removedElements: any | undefined;

  constructor(props: GraphFindProps) {
    super(props);

    this.findAutoComplete = new AutoComplete(operands);
    this.hideAutoComplete = new AutoComplete(operands);

    let findValue = props.findValue ? props.findValue : '';
    let hideValue = props.hideValue ? props.hideValue : '';

    // Let URL override current redux state at construction time. Update URL as needed.
    const urlParams = new URLSearchParams(history.location.search);
    const urlFind = HistoryManager.getParam(URLParam.GRAPH_FIND, urlParams);
    if (!!urlFind) {
      if (urlFind !== findValue) {
        findValue = urlFind;
        props.setFindValue(urlFind);
      }
    } else if (!!findValue) {
      HistoryManager.setParam(URLParam.GRAPH_FIND, findValue);
    }
    const urlHide = HistoryManager.getParam(URLParam.GRAPH_HIDE, urlParams);
    if (!!urlHide) {
      if (urlHide !== hideValue) {
        hideValue = urlHide;
        props.setHideValue(urlHide);
      }
    } else if (!!hideValue) {
      HistoryManager.setParam(URLParam.GRAPH_HIDE, hideValue);
    }

    this.state = { findInputValue: findValue, hideInputValue: hideValue };

    if (props.showFindHelp) {
      props.toggleFindHelp();
    }
  }

  // We only update on a change to the find/hide/compress values, or a graph change.  Although we use other props
  // in processing (compressOnHide, layout, etc), a change to those settings will generate a graph change, so we
  // wait for the graph change to do the update.
  shouldComponentUpdate(nextProps: GraphFindProps, nextState: GraphFindState) {
    const cyChanged = this.props.cy !== nextProps.cy;
    const findChanged = this.props.findValue !== nextProps.findValue;
    const hideChanged = this.props.hideValue !== nextProps.hideValue;
    const graphChanged = this.props.updateTime !== nextProps.updateTime;
    const showFindHelpChanged = this.props.showFindHelp !== nextProps.showFindHelp;
    const findErrorChanged = this.state.findError !== nextState.findError;
    const hideErrorChanged = this.state.hideError !== nextState.hideError;

    const shouldUpdate =
      cyChanged ||
      findChanged ||
      hideChanged ||
      graphChanged ||
      showFindHelpChanged ||
      findErrorChanged ||
      hideErrorChanged;

    return shouldUpdate;
  }

  // Note that we may have redux hide/find values set at mount-time. But because the toolbar mounts prior to
  // the graph loading, we can't perform this graph "post-processing" until we have a valid cy graph.  But the
  // find/hide processing will be initiated externally (CytoscapeGraph:processgraphUpdate) when the graph is ready.
  componentDidUpdate(prevProps: GraphFindProps) {
    if (!this.props.cy) {
      this.hiddenElements = undefined;
      this.removedElements = undefined;
      return;
    }

    const findChanged = this.props.findValue !== prevProps.findValue;
    const hideChanged = this.props.hideValue !== prevProps.hideValue;
    const graphChanged = this.props.updateTime !== prevProps.updateTime;
    const graphElementsChanged = graphChanged && this.props.elementsChanged;

    // ensure redux state and URL are aligned
    if (findChanged) {
      if (!this.props.findValue) {
        HistoryManager.deleteParam(URLParam.GRAPH_FIND, true);
      } else {
        HistoryManager.setParam(URLParam.GRAPH_FIND, this.props.findValue);
      }
    }
    if (hideChanged) {
      if (!this.props.hideValue) {
        HistoryManager.deleteParam(URLParam.GRAPH_HIDE, true);
      } else {
        HistoryManager.setParam(URLParam.GRAPH_HIDE, this.props.hideValue);
      }
    }

    // make sure the value is updated if there was a change
    if (findChanged || (graphChanged && !!this.props.findValue)) {
      // ensure findInputValue is aligned if findValue is set externally (e.g. resetSettings)
      if (this.state.findInputValue !== this.props.findValue) {
        this.setFind(this.props.findValue);
      }

      this.handleFind(this.props.cy);
    }

    if (hideChanged || (graphChanged && !!this.props.hideValue)) {
      // ensure hideInputValue is aligned if hideValue is set externally (e.g. resetSettings)
      if (this.state.hideInputValue !== this.props.hideValue) {
        this.setHide(this.props.hideValue);
      }

      const compressOnHideChanged = this.props.compressOnHide !== prevProps.compressOnHide;
      this.handleHide(this.props.cy, hideChanged, graphChanged, graphElementsChanged, compressOnHideChanged);
    }
  }

  render() {
    return (
      <TourStopContainer info={GraphTourStops.Find}>
        <Form style={{ float: 'left' }} isHorizontal={true}>
          <span className={thinGroupStyle}>
            <TextInput
              id="graph_find"
              name="graph_find"
              ref={ref => {
                this.findInputRef = ref;
              }}
              style={{ ...inputWidth }}
              type="text"
              autoComplete="on"
              isValid={!this.state.findError}
              onChange={this.updateFind}
              defaultValue={this.state.findInputValue}
              onKeyDownCapture={this.checkSpecialKeyFind}
              placeholder="Find..."
            />
            <GraphFindOptions kind="find" onSelect={this.updateFindOption} />
            {this.props.findValue && (
              <Tooltip key="ot_clear_find" position="top" content="Clear Find...">
                <Button
                  style={{ minWidth: '20px', width: '20px', paddingLeft: '5px', paddingRight: '5px', bottom: '1px' }}
                  variant={ButtonVariant.control}
                  onClick={() => this.setFind('')}
                >
                  <KialiIcon.Close />
                </Button>
              </Tooltip>
            )}
            <TextInput
              id="graph_hide"
              name="graph_hide"
              ref={ref => {
                this.hideInputRef = ref;
              }}
              style={{ ...inputWidth }}
              autoComplete="on"
              isValid={!this.state.hideError}
              type="text"
              onChange={this.updateHide}
              defaultValue={this.state.hideInputValue}
              onKeyDownCapture={this.checkSpecialKeyHide}
              placeholder="Hide..."
            />
            <GraphFindOptions kind="hide" onSelect={this.updateHideOption} />
            {this.props.hideValue && (
              <Tooltip key="ot_clear_hide" position="top" content="Clear Hide...">
                <Button
                  style={{ minWidth: '20px', width: '20px', paddingLeft: '5px', paddingRight: '5px', bottom: '1px' }}
                  variant={ButtonVariant.control}
                  onClick={() => this.setHide('')}
                >
                  <KialiIcon.Close />
                </Button>
              </Tooltip>
            )}
            {this.props.showFindHelp ? (
              <GraphHelpFind onClose={this.toggleFindHelp}>
                <Button variant={ButtonVariant.link} style={{ paddingLeft: '6px' }} onClick={this.toggleFindHelp}>
                  <KialiIcon.Info className={defaultIconStyle} />
                </Button>
              </GraphHelpFind>
            ) : (
              <Tooltip key={'ot_graph_find_help'} position="top" content="Find/Hide Help...">
                <Button variant={ButtonVariant.link} style={{ paddingLeft: '6px' }} onClick={this.toggleFindHelp}>
                  <KialiIcon.Info className={defaultIconStyle} />
                </Button>
              </Tooltip>
            )}
            {this.state.findError && <div style={{ color: 'red' }}>{this.state.findError}</div>}
            {this.state.hideError && <div style={{ color: 'red' }}>{this.state.hideError}</div>}
          </span>
        </Form>
      </TourStopContainer>
    );
  }

  private toggleFindHelp = () => {
    this.props.toggleFindHelp();
  };

  private checkSpecialKeyFind = event => {
    const keyCode = event.keyCode ? event.keyCode : event.which;
    switch (keyCode) {
      case 9: // tab (autocomplete)
        event.preventDefault();
        const next = this.findAutoComplete.next();
        if (!!next) {
          this.findInputRef.value = next;
          this.findInputRef.scrollLeft = this.findInputRef.scrollWidth;
          this.setState({ findInputValue: next, findError: undefined });
        }
        break;
      case 13: // return (submit)
        event.preventDefault();
        this.submitFind();
        break;
      default:
        break;
    }
  };

  private updateFindOption = key => {
    this.setFind(key);
  };

  private updateFind = val => {
    if ('' === val) {
      this.setFind('');
    } else {
      const diff = Math.abs(val.length - this.state.findInputValue.length);
      this.findAutoComplete.setInput(val, [' ', '!']);
      this.setState({ findInputValue: val, findError: undefined });
      // submit if length change is greater than a single key, assume browser suggestion clicked or user paste
      if (diff > 1) {
        this.props.setFindValue(val);
      }
    }
  };

  private setFind = val => {
    // TODO: when TextInput refs are fixed in PF4 then use the ref and remove the direct HTMLElement usage
    this.findInputRef.value = val;
    const htmlInputElement: HTMLInputElement = document.getElementById('graph_find') as HTMLInputElement;
    if (htmlInputElement !== null) {
      htmlInputElement.value = val;
    }
    this.findAutoComplete.setInput(val);
    this.setState({ findInputValue: val, findError: undefined });
    this.props.setFindValue(val);
  };

  private submitFind = () => {
    if (this.props.findValue !== this.state.findInputValue) {
      this.props.setFindValue(this.state.findInputValue);
    }
  };

  private checkSpecialKeyHide = event => {
    const keyCode = event.keyCode ? event.keyCode : event.which;
    switch (keyCode) {
      case 9: // tab (autocomplete)
        event.preventDefault();
        const next = this.hideAutoComplete.next();
        if (!!next) {
          this.hideInputRef.value = next;
          this.hideInputRef.scrollLeft = this.hideInputRef.scrollWidth;
          this.setState({ hideInputValue: next, hideError: undefined });
        }
        break;
      case 13: // return (submit)
        event.preventDefault();
        this.submitHide();
        break;
      default:
        break;
    }
  };

  private updateHideOption = key => {
    this.setHide(key);
  };

  private updateHide = val => {
    if ('' === val) {
      this.setHide('');
    } else {
      const diff = Math.abs(val.length - this.state.hideInputValue.length);
      this.hideAutoComplete.setInput(val, [' ', '!']);
      this.setState({ hideInputValue: val, hideError: undefined });
      // submit if length change is greater than a single key, assume browser suggestion clicked or user paste
      if (diff > 1) {
        this.props.setHideValue(val);
      }
    }
  };

  private submitHide = () => {
    if (this.props.hideValue !== this.state.hideInputValue) {
      this.props.setHideValue(this.state.hideInputValue);
    }
  };

  private setHide = val => {
    // TODO: when TextInput refs are fixed in PF4 then use the ref and remove the direct HTMLElement usage
    this.hideInputRef.value = val;
    const htmlInputElement: HTMLInputElement = document.getElementById('graph_hide') as HTMLInputElement;
    if (htmlInputElement !== null) {
      htmlInputElement.value = val;
    }
    this.hideAutoComplete.setInput(val);
    this.setState({ hideInputValue: val, hideError: undefined });
    this.props.setHideValue(val);
  };

  private handleHide = (
    cy: any,
    hideChanged: boolean,
    graphChanged: boolean,
    graphElementsChanged: boolean,
    compressOnHideChanged: boolean
  ) => {
    const selector = this.parseValue(this.props.hideValue, false);
    console.debug(`Hide selector=[${selector}]`);

    cy.startBatch();

    // unhide hidden elements when we are dealing with the same graph. Either way,release for garbage collection
    if (!!this.hiddenElements && !graphChanged) {
      this.hiddenElements.style({ visibility: 'visible' });
    }
    this.hiddenElements = undefined;

    // restore removed elements when we are working with the same graph. Either way,release for garbage collection.  If the graph has changed
    if (!!this.removedElements && !graphChanged) {
      this.removedElements.restore();
    }
    this.removedElements = undefined;

    if (selector) {
      // select the new hide-hits
      let hiddenElements = cy.$(selector);
      // add the edges connected to hidden nodes
      hiddenElements = hiddenElements.add(hiddenElements.connectedEdges());
      // add nodes with only hidden edges (keep idle nodes as that is an explicit option)
      const visibleElements = hiddenElements.absoluteComplement();
      const nodesWithVisibleEdges = visibleElements.edges().connectedNodes();
      const nodesWithOnlyHiddenEdges = visibleElements.nodes(`[^${CyNode.isIdle}]`).subtract(nodesWithVisibleEdges);
      hiddenElements = hiddenElements.add(nodesWithOnlyHiddenEdges);
      // subtract any appbox hits, we only hide empty appboxes
      hiddenElements = hiddenElements.subtract(hiddenElements.filter('$node[isBox]'));

      if (this.props.compressOnHide) {
        this.removedElements = cy.remove(hiddenElements);
        // now subtract any appboxes that don't have any visible children
        const hiddenAppBoxes = cy.$('$node[isBox]').subtract(cy.$('$node[isBox] > :inside'));
        this.removedElements = this.removedElements.add(cy.remove(hiddenAppBoxes));
      } else {
        // set the remaining hide-hits hidden
        this.hiddenElements = hiddenElements;
        this.hiddenElements.style({ visibility: 'hidden' });
        // now subtract any appboxes that don't have any visible children
        const hiddenAppBoxes = cy.$('$node[isBox]').subtract(cy.$('$node[isBox] > :visible'));
        hiddenAppBoxes.style({ visibility: 'hidden' });
        this.hiddenElements = this.hiddenElements.add(hiddenAppBoxes);
      }
    }

    cy.endBatch();

    const hasRemovedElements: boolean = !!this.removedElements && this.removedElements.length > 0;
    if (hideChanged || (compressOnHideChanged && selector) || (hasRemovedElements && graphElementsChanged)) {
      cy.emit('kiali-zoomignore', [true]);
      CytoscapeGraphUtils.runLayout(cy, this.props.layout).then(() => {
        // do nothing, defer to CytoscapeGraph.tsx 'onlayout' event handler
      });
    }
  };

  private handleFind = (cy: any) => {
    const selector = this.parseValue(this.props.findValue, true);
    console.debug(`Find selector=[${selector}]`);

    cy.startBatch();
    // unhighlight old find-hits
    cy.elements('*.find').removeClass('find');
    if (selector) {
      // add new find-hits
      cy.elements(selector).addClass('find');
    }
    cy.endBatch();
  };

  private setError(error: string | undefined, isFind: boolean): undefined {
    if (isFind && error !== this.state.findError) {
      const findError = !!error ? `Find: ${error}` : undefined;
      this.setState({ findError: findError });
    } else if (error !== this.state.hideError) {
      const hideError = !!error ? `Hide: ${error}` : undefined;
      this.setState({ hideError: hideError });
    }
    return undefined;
  }

  private parseValue = (val: string, isFind: boolean): string | undefined => {
    let preparedVal = this.prepareValue(val);
    if (!preparedVal) {
      return undefined;
    }

    // generate separate selectors for each disjunctive clause and then stitch them together. This
    // lets us mix node and edge criteria.
    const orClauses = preparedVal.split(' OR ');
    let orSelector;

    for (const clause of orClauses) {
      const expressions = clause.split(' AND ');
      const conjunctive = expressions.length > 1;
      let selector;

      for (const expression of expressions) {
        const parsedExpression = this.parseExpression(expression, conjunctive, isFind);
        if (!parsedExpression) {
          return undefined;
        }
        selector = this.appendSelector(selector, parsedExpression, isFind);
        if (!selector) {
          return undefined;
        }
      }
      // parsed successfully, clear any previous error message
      this.setError(undefined, isFind);
      orSelector = !orSelector ? selector : `${orSelector},${selector}`;
    }

    return orSelector;
  };

  private prepareValue = (val: string): string => {
    // remove double spaces
    val = val.replace(/ +(?= )/g, '');

    // remove unnecessary mnemonic qualifiers on unary operators (e.g. 'has cb' -> 'cb').
    val = ' ' + val;
    val = val.replace(/ is /gi, ' ');
    val = val.replace(/ has /gi, ' ');
    val = val.replace(/ !\s*is /gi, ' ! ');
    val = val.replace(/ !\s*has /gi, ' ! ');

    // replace string operators
    val = val.replace(/ not /gi, ' !');
    val = val.replace(/ !\s*contains /gi, ' !*= ');
    val = val.replace(/ !\s*startswith /gi, ' !^= ');
    val = val.replace(/ !\s*endswith /gi, ' !$= ');
    val = val.replace(/ contains /gi, ' *= ');
    val = val.replace(/ startswith /gi, ' ^= ');
    val = val.replace(/ endswith /gi, ' $= ');

    // uppercase conjunctions
    val = val.replace(/ and /gi, ' AND ');
    val = val.replace(/ or /gi, ' OR ');

    return val.trim();
  };

  private parseExpression = (
    expression: string,
    conjunctive: boolean,
    isFind: boolean
  ): ParsedExpression | undefined => {
    let op;
    if (expression.includes('!=')) {
      op = '!=';
    } else if (expression.includes('!*=')) {
      op = '!*=';
    } else if (expression.includes('!$=')) {
      op = '!$=';
    } else if (expression.includes('!^=')) {
      op = '!^=';
    } else if (expression.includes('>=')) {
      op = '>=';
    } else if (expression.includes('<=')) {
      op = '<=';
    } else if (expression.includes('*=')) {
      op = '*='; // substring
    } else if (expression.includes('$=')) {
      op = '$='; // starts with
    } else if (expression.includes('^=')) {
      op = '^='; // ends with
    } else if (expression.includes('=')) {
      op = '=';
    } else if (expression.includes('>')) {
      op = '>';
    } else if (expression.includes('<')) {
      op = '<';
    } else if (expression.includes('!')) {
      op = '!';
    }
    if (!op) {
      if (expression.split(' ').length > 1) {
        return this.setError(`No valid operator found in expression`, isFind);
      }

      const unaryExpression = this.parseUnaryFindExpression(expression.trim(), false);
      return unaryExpression ? unaryExpression : this.setError(`Invalid Node or Edge operand`, isFind);
    }

    const tokens = expression.split(op);
    if (op === '!') {
      const unaryExpression = this.parseUnaryFindExpression(tokens[1].trim(), true);
      return unaryExpression ? unaryExpression : this.setError(`Invalid Node or Edge operand`, isFind);
    }

    const field = tokens[0].trim();
    const val = tokens[1].trim();

    switch (field.toLowerCase()) {
      //
      // nodes...
      //
      case 'app':
        return { target: 'node', selector: `[${CyNode.app} ${op} "${val}"]` };
      case 'cluster':
        return { target: 'node', selector: `[${CyNode.cluster} ${op} "${val}"]` };
      case 'grpcin': {
        const s = this.getNumericSelector(CyNode.grpcIn, op, val, expression, isFind);
        return s ? { target: 'node', selector: s } : undefined;
      }
      case 'grpcout': {
        const s = this.getNumericSelector(CyNode.grpcOut, op, val, expression, isFind);
        return s ? { target: 'node', selector: s } : undefined;
      }
      case 'httpin': {
        const s = this.getNumericSelector(CyNode.httpIn, op, val, expression, isFind);
        return s ? { target: 'node', selector: s } : undefined;
      }
      case 'httpout': {
        const s = this.getNumericSelector(CyNode.httpOut, op, val, expression, isFind);
        return s ? { target: 'node', selector: s } : undefined;
      }
      case 'name': {
        const isNegation = op.startsWith('!');
        if (conjunctive) {
          return this.setError(`Can not use 'AND' with 'name' operand`, isFind);
        }
        const agg = `[${CyNode.aggregateValue} ${op} "${val}"]`;
        const app = `[${CyNode.app} ${op} "${val}"]`;
        const svc = `[${CyNode.service} ${op} "${val}"]`;
        const wl = `[${CyNode.workload} ${op} "${val}"]`;
        return { target: 'node', selector: isNegation ? `${agg}${app}${svc}${wl}` : `${agg},${app},${svc},${wl}` };
      }
      case 'node':
        let nodeType = val.toLowerCase();
        switch (nodeType) {
          case 'op':
          case 'operation':
            nodeType = NodeType.AGGREGATE;
            break;
          case 'svc':
            nodeType = NodeType.SERVICE;
            break;
          case 'wl':
            nodeType = NodeType.WORKLOAD;
            break;
          default:
            break; // no-op
        }
        switch (nodeType) {
          case NodeType.AGGREGATE:
          case NodeType.APP:
          case NodeType.SERVICE:
          case NodeType.WORKLOAD:
          case NodeType.UNKNOWN:
            return { target: 'node', selector: `[${CyNode.nodeType} ${op} "${nodeType}"]` };
          default:
            this.setError(
              `Invalid node type [${nodeType}]. Expected app | operation | service | unknown | workload`,
              isFind
            );
        }
        return undefined;
      case 'ns':
      case 'namespace':
        return { target: 'node', selector: `[${CyNode.namespace} ${op} "${val}"]` };
      case 'op':
      case 'operation':
        return { target: 'node', selector: `[${CyNode.aggregateValue} ${op} "${val}"]` };
      case 'rank': {
        if (!this.props.showRank) {
          AlertUtils.addSuccess('Enabling "Rank" display option for graph find/hide expression');
          this.props.toggleRank();
        }

        const valAsNum = Number(val);
        if (Number.isNaN(valAsNum) || valAsNum < 1 || valAsNum > 100) {
          return this.setError(`Invalid rank range [${val}]. Expected a number between 1..100`, isFind);
        }
        const s = this.getNumericSelector(CyNode.rank, op, val, expression, isFind);
        return s ? { target: 'node', selector: s } : undefined;
      }
      case 'svc':
      case 'service':
        return { target: 'node', selector: `[${CyNode.service} ${op} "${val}"]` };
      case 'tcpin': {
        const s = this.getNumericSelector(CyNode.tcpIn, op, val, expression, isFind);
        return s ? { target: 'node', selector: s } : undefined;
      }
      case 'tcpout': {
        const s = this.getNumericSelector(CyNode.tcpOut, op, val, expression, isFind);
        return s ? { target: 'node', selector: s } : undefined;
      }
      case 'version':
        return { target: 'node', selector: `[${CyNode.version} ${op} "${val}"]` };
      case 'wl':
      case 'workload':
        return { target: 'node', selector: `[${CyNode.workload} ${op} "${val}"]` };
      //
      // edges..
      //
      case 'destprincipal':
        if (!this.props.showSecurity) {
          AlertUtils.addSuccess('Enabling "Security" display option for graph find/hide expression');
          this.props.toggleGraphSecurity();
        }
        return { target: 'edge', selector: `[${CyEdge.destPrincipal} ${op} "${val}"]` };
      case 'grpc': {
        const s = this.getNumericSelector(CyEdge.grpc, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case '%grpcerror':
      case '%grpcerr': {
        const s = this.getNumericSelector(CyEdge.grpcPercentErr, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case '%grpctraffic': {
        const s = this.getNumericSelector(CyEdge.grpcPercentReq, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case 'http': {
        const s = this.getNumericSelector(CyEdge.http, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case '%httperror':
      case '%httperr': {
        const s = this.getNumericSelector(CyEdge.httpPercentErr, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case '%httptraffic': {
        const s = this.getNumericSelector(CyEdge.httpPercentReq, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case 'protocol': {
        return { target: 'edge', selector: `[${CyEdge.protocol} ${op} "${val}"]` };
      }
      case 'rt':
      case 'responsetime': {
        if (!this.props.edgeLabels.includes(EdgeLabelMode.RESPONSE_TIME_GROUP)) {
          AlertUtils.addSuccess('Enabling [P95] "Response Time" edge labels for this graph find/hide expression');
          this.props.setEdgeLabels([
            ...this.props.edgeLabels,
            EdgeLabelMode.RESPONSE_TIME_GROUP,
            EdgeLabelMode.RESPONSE_TIME_P95
          ]);
        }
        const s = this.getNumericSelector(CyEdge.responseTime, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case 'sourceprincipal':
        if (!this.props.showSecurity) {
          AlertUtils.addSuccess('Enabling "Security" display option for this graph find/hide expression');
          this.props.toggleGraphSecurity();
        }
        return { target: 'edge', selector: `[${CyEdge.sourcePrincipal} ${op} "${val}"]` };
      case 'tcp': {
        const s = this.getNumericSelector(CyEdge.tcp, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      case 'throughput': {
        if (!this.props.edgeLabels.includes(EdgeLabelMode.THROUGHPUT_GROUP)) {
          AlertUtils.addSuccess('Enabling [Request] "Throughput" edge labels for this graph find/hide expression');
          this.props.setEdgeLabels([
            ...this.props.edgeLabels,
            EdgeLabelMode.THROUGHPUT_GROUP,
            EdgeLabelMode.THROUGHPUT_REQUEST
          ]);
        }
        const s = this.getNumericSelector(CyEdge.throughput, op, val, expression, isFind);
        return s ? { target: 'edge', selector: s } : undefined;
      }
      default:
        return this.setError(`Invalid operand [${field}]`, isFind);
    }
  };

  private getNumericSelector(
    field: string,
    op: string,
    val: any,
    _expression: string,
    isFind: boolean
  ): string | undefined {
    switch (op) {
      case '>':
      case '<':
      case '>=':
      case '<=':
        if (isNaN(val)) {
          return this.setError(`Invalid value [${val}]. Expected a numeric value (use '.' for decimals)`, isFind);
        }
        return `[${field} ${op} ${val}]`;
      case '=':
        if (isNaN(val)) {
          return `[!${field}]`;
        }
        return `[${field} ${op} ${val}]`;
      case '!=':
        if (isNaN(val)) {
          return `[?${field}]`;
        }
        return `[${field} ${op} ${val}]`;
      default:
        return this.setError(`Invalid operator [${op}] for numeric condition`, isFind);
    }
  }

  private parseUnaryFindExpression = (field: string, isNegation): ParsedExpression | undefined => {
    switch (field.toLowerCase()) {
      //
      // nodes...
      //
      case 'cb':
      case 'circuitbreaker':
        return { target: 'node', selector: isNegation ? `[^${CyNode.hasCB}]` : `[?${CyNode.hasCB}]` };
      case 'dead':
        return { target: 'node', selector: isNegation ? `[^${CyNode.isDead}]` : `[?${CyNode.isDead}]` };
      case 'fi':
      case 'faultinjection':
        return {
          target: 'node',
          selector: isNegation ? `[^${CyNode.hasFaultInjection}]` : `[?${CyNode.hasFaultInjection}]`
        };
      case 'inaccessible':
        return { target: 'node', selector: isNegation ? `[^${CyNode.isInaccessible}]` : `[?${CyNode.isInaccessible}]` };
      case 'healthy':
        return {
          target: 'node',
          selector: isNegation
            ? `[${CyNode.healthStatus} = "${FAILURE.name}"],[${CyNode.healthStatus} = "${DEGRADED.name}"]`
            : `[${CyNode.healthStatus} = "${HEALTHY.name}"]`
        };
      case 'idle':
        if (!this.props.showIdleNodes) {
          AlertUtils.addSuccess('Enabling "Idle nodes" display option for graph find/hide expression');
          this.props.toggleIdleNodes();
        }
        return { target: 'node', selector: isNegation ? `[^${CyNode.isIdle}]` : `[?${CyNode.isIdle}]` };
      case 'mirroring':
        return {
          target: 'node',
          selector: isNegation ? `[^${CyNode.hasMirroring}]` : `[?${CyNode.hasMirroring}]`
        };
      case 'outside':
      case 'outsider':
        return { target: 'node', selector: isNegation ? `[^${CyNode.isOutside}]` : `[?${CyNode.isOutside}]` };
      case 'rr':
      case 'requestrouting':
        return {
          target: 'node',
          selector: isNegation ? `[^${CyNode.hasRequestRouting}]` : `[?${CyNode.hasRequestRouting}]`
        };
      case 'rto':
      case 'requesttimeout':
        return {
          target: 'node',
          selector: isNegation ? `[^${CyNode.hasRequestTimeout}]` : `[?${CyNode.hasRequestTimeout}]`
        };
      case 'se':
      case 'serviceentry':
        return { target: 'node', selector: isNegation ? `[^${CyNode.isServiceEntry}]` : `[?${CyNode.isServiceEntry}]` };
      case 'sc':
      case 'sidecar':
        return { target: 'node', selector: isNegation ? `[?${CyNode.hasMissingSC}]` : `[^${CyNode.hasMissingSC}]` };
      case 'tcpts':
      case 'tcptrafficshifting':
        return {
          target: 'node',
          selector: isNegation ? `[^${CyNode.hasTCPTrafficShifting}]` : `[?${CyNode.hasTCPTrafficShifting}]`
        };
      case 'ts':
      case 'trafficshifting':
        return {
          target: 'node',
          selector: isNegation ? `[^${CyNode.hasTrafficShifting}]` : `[?${CyNode.hasTrafficShifting}]`
        };
      case 'trafficsource':
      case 'root':
        return { target: 'node', selector: isNegation ? `[^${CyNode.isRoot}]` : `[?${CyNode.isRoot}]` };
      case 'vs':
      case 'virtualservice':
        return { target: 'node', selector: isNegation ? `[^${CyNode.hasVS}]` : `[?${CyNode.hasVS}]` };
      case 'we':
      case 'workloadentry':
        return {
          target: 'node',
          selector: isNegation ? `[^${CyNode.hasWorkloadEntry}]` : `[?${CyNode.hasWorkloadEntry}]`
        };
      //
      // edges...
      //
      case 'mtls':
        if (!this.props.showSecurity) {
          AlertUtils.addSuccess('Enabling "Security" display option for graph find/hide expression');
          this.props.toggleGraphSecurity();
        }
        return { target: 'edge', selector: isNegation ? `[${CyEdge.isMTLS} <= 0]` : `[${CyEdge.isMTLS} > 0]` };
      case 'traffic': {
        return { target: 'edge', selector: isNegation ? `[^${CyEdge.hasTraffic}]` : `[?${CyEdge.hasTraffic}]` };
      }
      default:
        return undefined;
    }
  };

  private appendSelector = (
    selector: string,
    parsedExpression: ParsedExpression,
    isFind: boolean
  ): string | undefined => {
    if (!selector) {
      return parsedExpression.target + parsedExpression.selector;
    }
    if (!selector.startsWith(parsedExpression.target)) {
      return this.setError('Invalid expression. Can not AND node and edge criteria.', isFind);
    }
    return selector + parsedExpression.selector;
  };
}

const mapStateToProps = (state: KialiAppState) => ({
  compressOnHide: state.graph.toolbarState.compressOnHide,
  edgeLabels: edgeLabelsSelector(state),
  findValue: findValueSelector(state),
  hideValue: hideValueSelector(state),
  layout: state.graph.layout,
  showFindHelp: state.graph.toolbarState.showFindHelp,
  showIdleNodes: state.graph.toolbarState.showIdleNodes,
  showRank: state.graph.toolbarState.showRank,
  showSecurity: state.graph.toolbarState.showSecurity,
  updateTime: state.graph.updateTime
});

const mapDispatchToProps = (dispatch: ThunkDispatch<KialiAppState, void, KialiAppAction>) => {
  return {
    setEdgeLabels: bindActionCreators(GraphToolbarActions.setEdgeLabels, dispatch),
    setFindValue: bindActionCreators(GraphToolbarActions.setFindValue, dispatch),
    setHideValue: bindActionCreators(GraphToolbarActions.setHideValue, dispatch),
    toggleFindHelp: bindActionCreators(GraphToolbarActions.toggleFindHelp, dispatch),
    toggleGraphSecurity: bindActionCreators(GraphToolbarActions.toggleGraphSecurity, dispatch),
    toggleIdleNodes: bindActionCreators(GraphToolbarActions.toggleIdleNodes, dispatch),
    toggleRank: bindActionCreators(GraphToolbarActions.toggleRank, dispatch)
  };
};

const GraphFindContainer = connect(mapStateToProps, mapDispatchToProps)(GraphFind);

export default GraphFindContainer;
