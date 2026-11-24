const Controller = require('./Controller');

function isPlainObject (value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

class DeviceTemplatesController {
  constructor (Service) {
    this.service = Service;
  }

  async devicetemplatesGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesGET);
  }

  async devicetemplatesPOST (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesPOST);
  }

  async devicetemplatesIdGET (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesIdGET);
  }

  async devicetemplatesIdPUT (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesIdPUT);
  }

  async devicetemplatesIdDELETE (request, response) {
    await Controller.handleRequest(request, response, this.service.devicetemplatesIdDELETE);
  }

  async devicetemplatesIdApplyPOST (request, response) {
    const body = request && request.body;
    const keys = isPlainObject(body) ? Object.keys(body) : null;
    if (
      !keys ||
      keys.length !== 1 ||
      keys[0] !== 'deviceId' ||
      Object.getOwnPropertySymbols(body).length > 0
    ) {
      response.status(400).json({
        error: 'Invalid request body: must be an object containing only deviceId'
      });
      return;
    }
    await Controller.handleRequest(request, response, this.service.devicetemplatesIdApplyPOST);
  }
}

module.exports = DeviceTemplatesController;
