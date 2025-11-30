/**
 * Overleaf API Client
 * Handles authentication and API calls to Overleaf
 */

import fetch from 'node-fetch'
import FormData from 'form-data'
import fs from 'fs-extra'
import path from 'path'

/**
 * Overleaf API Client class
 */
export class OverleafClient {
  constructor(baseUrl, credentials) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.credentials = credentials
    this.cookies = null
    this.csrfToken = null
  }

  /**
   * Authenticate with Overleaf
   */
  async authenticate() {
    if (!this.credentials) {
      throw new Error('No credentials provided')
    }

    // First, get the CSRF token from the login page
    const loginPageResponse = await fetch(`${this.baseUrl}/login`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Overleaf-Local-Sync/1.0',
      },
    })

    // Extract CSRF token from cookies
    const setCookies = loginPageResponse.headers.raw()['set-cookie'] || []
    this.cookies = setCookies.map(cookie => cookie.split(';')[0]).join('; ')

    // Get CSRF token from the dev endpoint (if available) or parse from page
    try {
      const csrfResponse = await fetch(`${this.baseUrl}/dev/csrf`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Overleaf-Local-Sync/1.0',
          Cookie: this.cookies,
        },
      })
      if (csrfResponse.ok) {
        this.csrfToken = await csrfResponse.text()
      }
    } catch {
      // CSRF endpoint might not be available
    }

    // Perform login
    const loginResponse = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Overleaf-Local-Sync/1.0',
        Cookie: this.cookies,
        ...(this.csrfToken && { 'X-CSRF-Token': this.csrfToken }),
      },
      body: JSON.stringify({
        email: this.credentials.email,
        password: this.credentials.password,
      }),
      redirect: 'manual',
    })

    // Update cookies from login response
    const loginCookies = loginResponse.headers.raw()['set-cookie'] || []
    if (loginCookies.length > 0) {
      const newCookies = loginCookies.map(cookie => cookie.split(';')[0])
      this.cookies = [...this.cookies.split('; '), ...newCookies]
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('; ')
    }

    if (loginResponse.status === 302 || loginResponse.status === 200) {
      return true
    }

    const errorBody = await loginResponse.text()
    throw new Error(`Authentication failed: ${loginResponse.status} - ${errorBody}`)
  }

  /**
   * Make an authenticated API request
   */
  async request(endpoint, options = {}) {
    if (!this.cookies) {
      await this.authenticate()
    }

    const url = `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'Overleaf-Local-Sync/1.0',
        Cookie: this.cookies,
        ...(this.csrfToken && { 'X-CSRF-Token': this.csrfToken }),
        ...options.headers,
      },
    })

    // Handle re-authentication if session expired
    if (response.status === 401 || response.status === 403) {
      await this.authenticate()
      return this.request(endpoint, options)
    }

    return response
  }

  /**
   * List all projects for the authenticated user
   */
  async listProjects() {
    const response = await this.request('/api/project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      throw new Error(`Failed to list projects: ${response.status}`)
    }

    const data = await response.json()
    return data.projects || []
  }

  /**
   * Get project details
   */
  async getProject(projectId) {
    const response = await this.request(`/project/${projectId}/entities`)

    if (!response.ok) {
      throw new Error(`Failed to get project: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Create a new project
   */
  async createProject(projectName, template = 'basic') {
    const response = await this.request('/project/new', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName,
        template,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Failed to create project: ${response.status} - ${errorBody}`)
    }

    return response.json()
  }

  /**
   * Download project as ZIP
   */
  async downloadProject(projectId) {
    const response = await this.request(`/Project/${projectId}/download/zip`)

    if (!response.ok) {
      throw new Error(`Failed to download project: ${response.status}`)
    }

    return response.buffer()
  }

  /**
   * Get a specific file from the project
   */
  async getFile(projectId, fileId) {
    const response = await this.request(`/Project/${projectId}/file/${fileId}`)

    if (!response.ok) {
      throw new Error(`Failed to get file: ${response.status}`)
    }

    return response.buffer()
  }

  /**
   * Get a document's content
   */
  async getDocument(projectId, docId) {
    const response = await this.request(`/Project/${projectId}/doc/${docId}/download`)

    if (!response.ok) {
      throw new Error(`Failed to get document: ${response.status}`)
    }

    return response.text()
  }

  /**
   * Upload a file to a project
   */
  async uploadFile(projectId, folderId, filePath) {
    const form = new FormData()
    form.append('qqfile', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
    })

    const response = await this.request(
      `/project/${projectId}/upload?folder_id=${folderId}`,
      {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId) {
    const response = await this.request(`/Project/${projectId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to delete project: ${response.status}`)
    }

    return true
  }

  /**
   * Rename a project
   */
  async renameProject(projectId, newName) {
    const response = await this.request(`/project/${projectId}/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        newProjectName: newName,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to rename project: ${response.status}`)
    }

    return true
  }
}

export default OverleafClient
