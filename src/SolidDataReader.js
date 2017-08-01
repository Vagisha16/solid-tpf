import * as fs from 'fs';
import { join } from 'path';
import * as rdf from 'rdflib';
import promisify from 'promisify-node';
import { PermissionSet } from 'solid-permissions';

const { lstat, readdir, readFile } = promisify(fs);

const ACL_EXTENSION = '.acl';

export default class SolidDataReader {
  constructor({ url = '', path = '' } = {}) {
    this.url = url.replace(/\/$/, '');
    this.path = path.replace(/\/$/, '');
  }

  // Gets all files in this Solid instance
  async * getFiles() {
    const folders = [this.path];
    for (const folder of folders) {
      const items = (await readdir(folder)).map(f => join(folder, f));
      for (const item of items) {
        const stats = await lstat(item);
        if (stats.isFile())
          yield item;
        else if (stats.isDirectory())
          folders.push(item);
      }
    }
  }

  // Gets all agents that can read the given file
  async * getReaders(file) {
    const aclFile = await this.getAclFile(file);
    const url = this._getUrlOf(file);
    const aclUrl = this._getUrlOf(aclFile);
    const graph = await this._loadGraph(aclFile);
    const permissions = new PermissionSet(url, aclUrl, false, { graph, rdf });
    // Find all agents with any permission
    const agents = new Set();
    for (const { agent } of permissions.allAuthorizations())
      agents.add(agent);
    // Return those agents with read permissions
    for (const agent of agents) {
      if (await permissions.checkAccess(url, agent, 'Read'))
        yield agent;
    }
    // Only the first ACL file is valid
    return;
  }

  // Get the most specific ACL file for the given file
  async getAclFile(file) {
    for await (const aclFile of this.getAclFiles(file)) {
      const exists = await lstat(aclFile).then(f => f.isFile(), e => false);
      if (exists)
        return aclFile;
    }
    throw new Error(`No ACL file found for ${file}.`);
  }

  // Gets all possible ACL files for the given file
  async * getAclFiles(file) {
    // Ensure the file is within this Solid instance
    if (file.indexOf(this.path) !== 0)
      return;

    // An item without trailing slash could be a file or a folder
    if (!/\/$/.test(file)) {
      // Ensure folders always end in a slash
      if ((await lstat(file)).isDirectory())
        file += '/';
      // Files can have a file-specific ACL
      else {
        yield file + ACL_EXTENSION;
        file = file.replace(/[^\/]+$/, '');
      }
    }

    // Return ACLs for the current folder and all parent folders
    while (file.length >= this.path.length) {
      yield file + ACL_EXTENSION;
      file = file.replace(/[^\/]*\/$/, '');
    }
  }

  // Gets the URL corresponding to the file
  _getUrlOf(file) {
    if (file.indexOf(this.path) !== 0)
      return '';
    return this.url + file.substring(this.path.length);
  }

  // Loads and returns the graph in the given file
  async _loadGraph(file) {
    const graph = rdf.graph();
    const contents = await readFile(file, 'utf8');
    rdf.parse(contents, graph, this._getUrlOf(file), 'text/turtle');
    return graph;
  }
}