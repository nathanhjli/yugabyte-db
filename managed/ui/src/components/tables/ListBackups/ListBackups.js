// Copyright (c) YugaByte, Inc.

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router';
import Toggle from 'react-toggle';
import { DropdownButton, Alert } from 'react-bootstrap';
import { BootstrapTable, TableHeaderColumn } from 'react-bootstrap-table';
import moment from 'moment';
import { YBPanelItem } from '../../panels';
import { YBCopyButton } from '../../common/descriptors';
import { get } from '../../../utils/ObjectUtils';
import { getPromiseState } from '../../../utils/PromiseUtils';
import { isAvailable, isNotHidden } from '../../../utils/LayoutUtils';
import {
  timeFormatter,
  successStringFormatter,
  backupConfigFormatter
} from '../../../utils/TableFormatters';
import { YBLoadingCircleIcon } from '../../common/indicators';
import { TableAction } from '../../tables';
import ListTablesModal from './ListTablesModal';
import SchedulesContainer from '../../schedules/SchedulesContainer';
import './ListBackups.scss';
import { isNonEmptyArray } from '../../../utils/ObjectUtils';

const YSQL_TABLE_TYPE = 'PGSQL_TABLE_TYPE';
const YCQL_TABLE_TYPE = 'YQL_TABLE_TYPE';
const YEDIS_TABLE_TYPE = 'REDIS_TABLE_TYPE';

const getTableType = (text) => {
  switch (text) {
    case YSQL_TABLE_TYPE:
      return 'YSQL';
    case YCQL_TABLE_TYPE:
      return 'YCQL';
    case YEDIS_TABLE_TYPE:
      return 'YEDIS';
    default:
      return null;
  }
};

export default class ListBackups extends Component {
  state = {
    selectedRowList: null,
    showModal: false,
    showAlert: false,
    taskUUID: null,
    alertType: null,
    showDeletedBackups: false,
    selected: []
  };

  static defaultProps = {
    title: 'Backups'
  };

  static propTypes = {
    currentUniverse: PropTypes.object.isRequired
  };

  componentDidMount() {
    const {
      currentUniverse: { universeUUID }
    } = this.props;
    this.props.fetchUniverseBackups(universeUUID);
    this.props.fetchUniverseList();
  }

  componentWillUnmount() {
    this.props.resetUniverseBackups();
  }

  isMultiTableBackup = () => {
    return true;
  };

  copyStorageLocation = (item, row) => {
    return <YBCopyButton text={item} title={item} />;
  };

  openModal = (row) => {
    this.setState({
      selectedRowList: row.tableNameList,
      showModal: true
    });
  };

  closeModal = () => {
    this.setState({
      showModal: false
    });
  };

  parseTableType = (cell, rowData) => {
    const { universeTableTypes } = this.props;
    if (rowData.backupType) {
      return getTableType(rowData.backupType);
    } else if (rowData.tableUUIDList || rowData.tableUUID) {
      return rowData.tableUUIDList
        ? universeTableTypes[rowData.tableUUIDList[0]]
        : universeTableTypes[rowData.tableUUID];
    } else if (rowData.keyspace) {
      if (rowData.keyspace.indexOf('ysql.') === 0) {
        return 'YSQL';
      } else {
        return 'YCQL';
      }
    }
  };

  displayMultiTableNames = (cell, rowData) => {
    if (rowData.tableNameList && rowData.tableNameList.length) {
      if (rowData.tableNameList.length > 3) {
        // Display list of table names truncated if longer than 3
        const additionalTablesLink = (
          <strong className="bold-primary-link" onClick={() => this.openModal(rowData)}>
            {rowData.tableNameList.length - 3} more
          </strong>
        );

        return (
          <div>
            {rowData.tableNameList.slice(0, 3).join(', ')}, and {additionalTablesLink}
          </div>
        );
      }
      return rowData.tableNameList.join(', ');
    }
    return cell;
  };

  renderCaret = (direction, fieldName) => {
    if (direction === 'asc') {
      return (
        <span className="order">
          <i className="fa fa-caret-up orange-icon" />
        </span>
      );
    }
    if (direction === 'desc') {
      return (
        <span className="order">
          <i className="fa fa-caret-down orange-icon" />
        </span>
      );
    }
    return (
      <span className="order">
        <i className="fa fa-caret-down orange-icon" />
        <i className="fa fa-caret-up orange-icon" />
      </span>
    );
  };

  showMultiTableInfo = (row) => {
    const { currentCustomer } = this.props;
    let displayTableData = [{ ...row }];
    if (Array.isArray(row.backupList) && row.backupList.length) {
      return (
        <BootstrapTable
          data={row.backupList}
          className="backup-info-table"
          headerContainerClass="backup-header"
        >
          <TableHeaderColumn dataField="storageLocation" isKey={true} hidden={true} />
          <TableHeaderColumn
            dataField="keyspace"
            caretRender={this.renderCaret}
            dataSort
            dataAlign="left"
          >
            Keyspace
          </TableHeaderColumn>
          <TableHeaderColumn dataFormat={this.parseTableType} dataAlign="left">
            Backup Type
          </TableHeaderColumn>
          <TableHeaderColumn
            dataField="tableName"
            dataFormat={this.displayMultiTableNames}
            caretRender={this.renderCaret}
            dataSort
            dataAlign="left"
          >
            Table Name
          </TableHeaderColumn>
          {isNotHidden(
            currentCustomer.data.features,
            'universes.details.backups.storageLocation'
          ) && (
            <TableHeaderColumn
              dataField="storageLocation"
              dataFormat={this.copyStorageLocation}
              dataSort
              dataAlign="left"
            >
              Storage Location
            </TableHeaderColumn>
          )}
        </BootstrapTable>
      );
    } else if (row.tableUUIDList && row.tableUUIDList.length) {
      const displayedTablesText =
        row.tableNameList.length > 3 ? (
          <div>
            {row.tableNameList.slice(0, 3).join(', ')}, and{' '}
            <strong className="bold-primary-link" onClick={() => this.openModal(row)}>
              {row.tableNameList.length - 3} more
            </strong>
          </div>
        ) : (
          row.tableNameList.join(', ')
        );
      displayTableData = [
        {
          keyspace: row.keyspace,
          tableName: displayedTablesText,
          tableUUID: row.tableUUIDList[0], // Tables can't be repeated so take first one as row key
          storageLocation: row.storageLocation
        }
      ];
    }

    return (
      <BootstrapTable
        data={displayTableData}
        className="backup-info-table"
        headerContainerClass="backup-header"
      >
        <TableHeaderColumn dataField="tableUUID" isKey={true} hidden={true} />
        <TableHeaderColumn
          dataField="keyspace"
          caretRender={this.renderCaret}
          dataSort
          dataAlign="left"
        >
          {row.backupType === YSQL_TABLE_TYPE ? 'Namespace' : 'Keyspace'}
        </TableHeaderColumn>
        <TableHeaderColumn dataFormat={this.parseTableType} dataAlign="left">
          Backup Type
        </TableHeaderColumn>
        <TableHeaderColumn
          dataField="tableName"
          caretRender={this.renderCaret}
          dataFormat={this.displayMultiTableNames}
          dataSort
          dataAlign="left"
        >
          Table Name
        </TableHeaderColumn>
        {isNotHidden(
          currentCustomer.data.features,
          'universes.details.backups.storageLocation'
        ) && (
          <TableHeaderColumn
            dataField="storageLocation"
            dataFormat={this.copyStorageLocation}
            dataAlign="left"
          >
            Storage Location
          </TableHeaderColumn>
        )}
      </BootstrapTable>
    );
  };

  expandColumnComponent = ({ isExpandableRow, isExpanded }) => {
    if (isExpandableRow) {
      return isExpanded ? (
        <i className="fa fa-chevron-down" />
      ) : (
        <i className="fa fa-chevron-right" />
      );
    } else {
      return <span>&nbsp;</span>;
    }
  };

  handleModalSubmit = (type, data) => {
    const taskUUID = data?.taskUUID || null;
    this.setState({
      taskUUID,
      showAlert: true,
      alertType: type
    });
    setTimeout(() => {
      this.setState({
        showAlert: false
      });
    }, 4000);
  };

  handleDismissAlert = () => {
    this.setState({
      showAlert: false
    });
  };

  /**
   * This method will help us to get the particular backupUUID
   * for the selected row.
   *
   * @param {string} {backupUUID} Backup UUID.
   * @param {boolean} isSelected Selected row.
   * @returns Boolean
   */
  onRowSelect = ({ backupUUID }, isSelected) => {
    isSelected
      ? this.setState({ selected: [...this.state.selected, backupUUID].sort() })
      : this.setState({ selected: this.state.selected.filter((id) => id !== backupUUID) });

    return true;
  };

  /**
   * This method will help us to select all the backups for
   * the current page.
   *
   * @param {boolean} isSelected Selected rows.
   * @param {Array} rows Number of rows.
   * @returns Boolean
   */
  onSelectAll = (isSelected, rows) => {
    if (isSelected) {
      const selected = [...this.state.selected, ...rows.map((row) => row.backupUUID)];
      this.setState({ selected: selected });
    } else {
      this.setState({ selected: [] });
    }

    return true;
  };

  render() {
    const {
      currentCustomer,
      currentUniverse,
      universeBackupList,
      universeTableTypes,
      title
    } = this.props;
    const {
      showModal,
      taskUUID,
      showAlert,
      alertType,
      selectedRowList,
      showDeletedBackups,
      selected
    } = this.state;

    // Variable to set the checkbox for backup list table.
    const selectRowProp = {
      mode: 'checkbox',
      clickToExpand: true,
      onSelect: this.onRowSelect,
      onSelectAll: this.onSelectAll,
      selected: this.state.selected,
      unselectable: []
    };

    if (
      getPromiseState(universeBackupList).isLoading() ||
      getPromiseState(universeBackupList).isInit()
    ) {
      return <YBLoadingCircleIcon size="medium" />;
    }
    const universePaused = get(currentUniverse, 'universeDetails.universePaused');
    const backupInfos = universeBackupList.data
      .map((b) => {
        const backupInfo = b.backupInfo;
        if (
          (backupInfo.actionType === 'CREATE' && b.state !== 'Deleted') ||
          (showDeletedBackups && b.state === 'Deleted')
        ) {
          backupInfo.backupUUID = b.backupUUID;
          backupInfo.status = b.state;
          backupInfo.createTime = b.createTime;
          backupInfo.expiry = b.expiry;
          backupInfo.updateTime = b.updateTime;
          if (backupInfo.tableUUIDList && backupInfo.tableUUIDList.length > 1) {
            backupInfo.tableName = backupInfo.tableNameList.join(', ');
            backupInfo.tableType = [
              ...new Set(backupInfo.tableUUIDList.map((v) => universeTableTypes[v]))
            ].join(', ');
          } else {
            backupInfo.tableType = universeTableTypes[b.backupInfo.tableUUID];
          }
          // Show action button to restore/delete only when the backup is
          // create and which has completed successfully.
          backupInfo.showActions =
            backupInfo.actionType === 'CREATE' && backupInfo.status === 'Completed';
          return backupInfo;
        }
        return null;
      })
      .filter(Boolean);

    // Check for in-progress backups and mark them as unselctable.
    selectRowProp.unselectable = backupInfos
      .filter((backup) => backup.status === 'InProgress')
      .map((data) => data.backupUUID);

    const formatActionButtons = (item, row) => {
      if (row.showActions && isAvailable(currentCustomer.data.features, 'universes.backup')) {
        return (
          <DropdownButton
            className="btn btn-default"
            title="Actions"
            id="bg-nested-dropdown"
            pullRight
          >
            <TableAction
              currentRow={row}
              disabled={get(currentUniverse, 'universeDetails.backupInProgress')}
              actionType="restore-backup"
              onSubmit={(data) => this.handleModalSubmit('Restore', data)}
              onError={() => this.handleModalSubmit('Restore')}
            />
            <TableAction
              currentRow={row}
              actionType="delete-backup"
              onSubmit={(data) => this.handleModalSubmit('Delete', data)}
              onError={() => this.handleModalSubmit('Delete')}
            />
          </DropdownButton>
        );
      } else if (row.status === 'InProgress' && !row.showActions) {
        return (
          <DropdownButton
            className="btn btn-default"
            title="Actions"
            id="bg-nested-dropdown"
            pullRight
          >
            <TableAction
              currentRow={row}
              actionType="stop-backup"
              onError={() => this.handleModalSubmit('Stop')}
            />
          </DropdownButton>
        );
      }
    };

    const getBackupDuration = (item, row) => {
      const diffInMs = row.updateTime - row.createTime;
      return moment.duration(diffInMs).humanize();
    };

    const showBackupType = function (item, row) {
      if (row.backupList && row.backupList.length) {
        return (
          <div className="backup-type">
            <i className="fa fa-globe" aria-hidden="true" />{' '}
            {item === YCQL_TABLE_TYPE ? 'Multi-Keyspace backup' : 'Multi-Namespace backup'}
          </div>
        );
      } else if (row.tableUUIDList && row.tableUUIDList.length) {
        return (
          <div className="backup-type">
            <i className="fa fa-table" /> Multi-Table backup
          </div>
        );
      } else if (row.tableUUID) {
        return (
          <div className="backup-type">
            <i className="fa fa-file" /> Table backup
          </div>
        );
      } else if (row.keyspace != null) {
        const backupTableType =
          row.backupType === YSQL_TABLE_TYPE ? 'Namespace backup' : 'Keyspace backup';
        return (
          <div className="backup-type">
            <i className="fa fa-database" /> {backupTableType}
          </div>
        );
      }
    };
    return (
      <div id="list-backups-content">
        {get(currentUniverse, 'universeDetails.backupInProgress') && (
          <Alert bsStyle="info">Backup is in progress at the moment</Alert>
        )}
        {showAlert && (
          <Alert bsStyle={taskUUID ? 'success' : 'danger'} onDismiss={this.handleDismissAlert}>
            {isNonEmptyArray(taskUUID) && taskUUID.length < 2 ? (
              <div>
                {alertType} started successfully. See{' '}
                <Link to={`/tasks/${taskUUID}`}>task progress</Link>
              </div>
            ) : (
              <div>
                {alertType} started successfully. See <Link to="/tasks">task progress</Link>
              </div>
            )}
          </Alert>
        )}
        <SchedulesContainer />
        <YBPanelItem
          header={
            <div className="container-title clearfix spacing-top">
              <div className="pull-left">
                <h2 className="task-list-header content-title pull-left">{title}</h2>
              </div>
              <div className="pull-right">
                {isAvailable(currentCustomer.data.features, 'universes.backup') && (
                  <div className="backup-action-btn-group">
                    {!universePaused && (
                      <>
                        <TableAction
                          disabled={
                            get(currentUniverse, 'universeDetails.backupInProgress') ||
                            get(currentUniverse, 'universeConfig.takeBackups') === 'false'
                          }
                          className="table-action"
                          btnClass="btn-orange"
                          actionType="create-backup"
                          isMenuItem={false}
                          onSubmit={(data) => this.handleModalSubmit('Backup', data)}
                          onError={() => this.handleModalSubmit('Backup')}
                        />
                        <TableAction
                          disabled={get(currentUniverse, 'universeDetails.backupInProgress')}
                          className="table-action"
                          btnClass="btn-default"
                          actionType="restore-backup"
                          isMenuItem={false}
                          onSubmit={(data) => this.handleModalSubmit('Restore', data)}
                          onError={() => this.handleModalSubmit('Restore')}
                        />
                        <TableAction
                          disabled={
                            get(currentUniverse, 'universeDetails.backupInProgress') ||
                            this.state.selected.length < 1
                          }
                          currentRow={{
                            type: 'bulkDelete',
                            data: selected
                          }}
                          className="table-action"
                          btnClass="btn-default"
                          isMenuItem={false}
                          actionType="delete-backup"
                          onSubmit={(data) => this.handleModalSubmit('Delete', data)}
                          onError={() => this.handleModalSubmit('Delete')}
                        />
                        <div className="chk-show-deleted-backups">
                          <label>Show deleted backups</label>
                          <Toggle
                            checked={showDeletedBackups}
                            label="Show deleted backups"
                            onChange={(event) => {
                              this.setState({ showDeletedBackups: event.target.checked });
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          }
          body={
            <BootstrapTable
              data={backupInfos}
              pagination={true}
              className="backup-list-table"
              expandableRow={this.isMultiTableBackup}
              expandComponent={this.showMultiTableInfo}
              expandColumnOptions={{
                expandColumnVisible: true,
                expandColumnComponent: this.expandColumnComponent,
                columnWidth: 50
              }}
              options={{
                expandBy: 'column'
              }}
              selectRow={selectRowProp}
            >
              <TableHeaderColumn dataField="backupUUID" isKey={true} hidden={true} />
              <TableHeaderColumn
                dataField={'backupType'}
                dataFormat={showBackupType}
                expandable={false}
              >
                Type
              </TableHeaderColumn>
              <TableHeaderColumn
                dataField="createTime"
                dataFormat={timeFormatter}
                dataSort
                columnClassName="no-border "
                className="no-border"
                expandable={false}
                dataAlign="left"
              >
                Created At
              </TableHeaderColumn>
              <TableHeaderColumn
                dataField="expiry"
                dataFormat={timeFormatter}
                dataSort
                columnClassName="no-border "
                className="no-border"
                expandable={false}
                dataAlign="left"
              >
                Expiry Time
              </TableHeaderColumn>
              <TableHeaderColumn
                dataFormat={(_cell, row) => backupConfigFormatter(row, this.props.storageConfigs)}
                columnClassName="no-border "
                className="no-border"
                expandable={false}
                dataAlign="left"
              >
                Backup Config
              </TableHeaderColumn>
              <TableHeaderColumn
                dataFormat={getBackupDuration}
                dataSort
                columnClassName="no-border "
                className="no-border"
                expandable={false}
                dataAlign="left"
              >
                Duration
              </TableHeaderColumn>
              <TableHeaderColumn
                dataField="status"
                dataSort
                expandable={false}
                columnClassName="no-border name-column"
                className="no-border"
                dataFormat={successStringFormatter}
              >
                Status
              </TableHeaderColumn>
              {!universePaused && (
                <TableHeaderColumn
                  dataField={'actions'}
                  columnClassName={'no-border yb-actions-cell'}
                  className={'no-border yb-actions-cell'}
                  dataFormat={formatActionButtons}
                  headerAlign="center"
                  dataAlign="center"
                  expandable={false}
                >
                  Actions
                </TableHeaderColumn>
              )}
            </BootstrapTable>
          }
        />
        <ListTablesModal
          visible={showModal}
          data={selectedRowList}
          title={'Tables in backup'}
          onHide={this.closeModal}
        />
      </div>
    );
  }
}
