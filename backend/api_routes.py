from flask import Blueprint, jsonify
from flask_wtf.csrf import generate_csrf

api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/csrf-token')
def get_csrf_token():
    token = generate_csrf()
    return jsonify({'csrf_token': token})
